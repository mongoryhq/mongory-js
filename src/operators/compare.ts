import { CompileContext, OperatorBuilder } from "../compile_ctx.js";
import { compareValues, valuesEqual } from "../compare.js";
import { MatcherNode, formatTraceValue, formatValue, statusLabel, traceLeaf, writeTreeLine } from "../explain.js";
import { CompileConfig } from "../options.js";
import { MISSING, isRecordObject, sortedOwnKeys } from "../types.js";

export class ConvValueNode implements MatcherNode {
  constructor(
    private readonly cfg: CompileConfig,
    private readonly inner: MatcherNode,
    private readonly fixedLabel?: string,
  ) {}

  match(record: unknown): boolean {
    if (record === MISSING || record === null || record === undefined) {
      return this.inner.match(record);
    }
    const converted = this.cfg.applyConverter(record);
    return this.inner.match(converted);
  }

  priority(): number {
    return this.inner.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    this.inner.explain(lines, prefix, isLast, isRoot);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    const matched = this.match(record);
    let label = this.fixedLabel;
    if (!label) {
      const tmp: string[] = [];
      this.inner.explain(tmp, "", true, true);
      label = tmp[0] ?? "";
    }
    writeTreeLine(lines, prefix, isLast, isRoot, `[${statusLabel(matched)}] ${label} | value=${formatTraceValue(record)}`);
    return matched;
  }
}

type SeenPairs = WeakMap<object, WeakSet<object>>;

/**
 * Deep structural equality applying `cfg` converters once per convertible object.
 * Leaves scalar/no-converter paths strictly inside `valuesEqual`.
 */
export function valuesEqualConv(a: unknown, b: unknown, cfg: CompileConfig, seen?: SeenPairs): boolean {
  if (a === MISSING || b === MISSING || a === undefined || b === undefined) {
    return false;
  }
  const ca = a !== null && typeof a === "object" ? cfg.applyConverter(a) : a;
  if (ca !== a) {
    return valuesEqual(ca, b, seen);
  }
  if (a === null || b === null) {
    return a === null && b === null;
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return valuesEqual(a, b, seen);
  }
  if (a instanceof Date || b instanceof Date || a instanceof RegExp || b instanceof RegExp || a instanceof Uint8Array || b instanceof Uint8Array) {
    return valuesEqual(a, b, seen);
  }
  const pairMap = seen ?? new WeakMap<object, WeakSet<object>>();
  let set = pairMap.get(a);
  if (set?.has(b)) {
    return true;
  }
  if (!set) {
    set = new WeakSet<object>();
    pairMap.set(a, set);
  }
  set.add(b);
  try {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!valuesEqualConv(a[i], b[i], cfg, pairMap)) {
          return false;
        }
      }
      return true;
    }
    if (!isRecordObject(a) || !isRecordObject(b)) {
      return a === b;
    }
    const keysA = sortedOwnKeys(a).filter((k) => a[k] !== undefined);
    const keysB = sortedOwnKeys(b).filter((k) => b[k] !== undefined);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (let i = 0; i < keysA.length; i++) {
      const k = keysA[i];
      if (keysB[i] !== k || !valuesEqualConv(a[k], b[k], cfg, pairMap)) {
        return false;
      }
    }
    return true;
  } finally {
    set.delete(b);
  }
}

function matchEqWith(
  record: unknown,
  condition: unknown,
  eqFn: (a: unknown, b: unknown) => boolean,
): boolean {
  if (eqFn(record, condition)) {
    return true;
  }
  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i++) {
      if (eqFn(record[i], condition)) {
        return true;
      }
    }
  }
  return false;
}

abstract class BaseEqNode implements MatcherNode {
  constructor(
    protected readonly condition: unknown,
    protected readonly negate: boolean,
  ) {}

  abstract match(record: unknown): boolean;

  priority(): number {
    return 1;
  }

  protected label(): string {
    return `${this.negate ? "Ne" : "Eq"}(${formatValue(this.condition)})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }
}

export class EqNode extends BaseEqNode {
  match(record: unknown): boolean {
    return matchEqWith(record, this.condition, valuesEqual) !== this.negate;
  }
}

export class EqConvNode extends BaseEqNode {
  constructor(
    condition: unknown,
    private readonly cfg: CompileConfig,
    negate = false,
  ) {
    super(condition, negate);
  }

  match(record: unknown): boolean {
    return (
      matchEqWith(record, this.condition, (a, b) => valuesEqualConv(a, b, this.cfg)) !== this.negate
    );
  }
}

export function buildEqNode(ctx: CompileContext, condition: unknown, negate = false): MatcherNode {
  if (ctx.hasConverters()) {
    return ctx.addNodeMatcher(new EqConvNode(condition, ctx.cfg, negate));
  }
  return ctx.addNodeMatcher(new EqNode(condition, negate));
}

class OrderNode implements MatcherNode {
  constructor(
    private readonly op: string,
    private readonly condition: unknown,
    private readonly accept: (cmp: number) => boolean,
  ) {}

  match(record: unknown): boolean {
    const cmp = compareValues(record, this.condition);
    return cmp !== undefined && this.accept(cmp);
  }

  priority(): number {
    return 3;
  }

  private label(): string {
    return `${this.op}(${formatValue(this.condition)})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }
}

function makeOrderBuilder(op: string, accept: (cmp: number) => boolean): OperatorBuilder {
  return (ctx, condition) => {
    const node = ctx.addNodeMatcher(new OrderNode(op, condition, accept));
    if (ctx.hasConverters()) {
      return new ConvValueNode(ctx.cfg, node);
    }
    return node;
  };
}

export function registerCompareOperators(registry: Map<string, OperatorBuilder>): void {
  registry.set("$eq", (ctx, cond) => buildEqNode(ctx, cond, false));
  registry.set("$ne", (ctx, cond) => buildEqNode(ctx, cond, true));
  registry.set("$gt", makeOrderBuilder("Gt", (c) => c > 0));
  registry.set("$gte", makeOrderBuilder("Gte", (c) => c >= 0));
  registry.set("$lt", makeOrderBuilder("Lt", (c) => c < 0));
  registry.set("$lte", makeOrderBuilder("Lte", (c) => c <= 0));
}
