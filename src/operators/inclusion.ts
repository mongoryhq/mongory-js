import { CompileContext, OperatorBuilder, invalidCondition } from "../compile_ctx.js";
import { valuesEqual } from "../compare.js";
import {
  MatcherNode,
  formatValue,
  makeExplainNode,
  traceLeaf,
  traceLeafTreeNode,
  writeTreeLine,
} from "../explain.js";
import { describeType } from "../normalize.js";
import { CompileConfig } from "../options.js";
import { ExplainNode, MISSING, TraceNode } from "../types.js";
import { valuesEqualConv } from "./compare.js";

export const IN_SET_THRESHOLD = 16;

interface InLookup {
  hasNull: boolean;
  hasTrue: boolean;
  hasFalse: boolean;
  strings: Set<string> | undefined;
  numbers: Set<number> | undefined;
  bigints: Set<bigint> | undefined;
  dates: Set<number> | undefined;
  fallback: unknown[];
}

function buildInLookup(items: ReadonlyArray<unknown>): InLookup {
  const lookup: InLookup = {
    hasNull: false,
    hasTrue: false,
    hasFalse: false,
    strings: undefined,
    numbers: undefined,
    bigints: undefined,
    dates: undefined,
    fallback: [],
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === null) {
      lookup.hasNull = true;
    } else if (item === true) {
      lookup.hasTrue = true;
    } else if (item === false) {
      lookup.hasFalse = true;
    } else if (typeof item === "string") {
      lookup.strings ??= new Set<string>();
      lookup.strings.add(item);
    } else if (typeof item === "number") {
      // IEEE-754: NaN never equals anything, whereas JS Set uses SameValueZero.
      if (!Number.isNaN(item)) {
        lookup.numbers ??= new Set<number>();
        lookup.numbers.add(item);
      }
    } else if (typeof item === "bigint") {
      lookup.bigints ??= new Set<bigint>();
      lookup.bigints.add(item);
    } else if (item instanceof Date) {
      const ts = item.getTime();
      if (!Number.isNaN(ts)) {
        lookup.dates ??= new Set<number>();
        lookup.dates.add(ts);
      }
    } else if (item !== undefined && item !== MISSING) {
      lookup.fallback.push(item);
    }
  }
  return lookup;
}

function lookupContains(lookup: InLookup, value: unknown): boolean {
  if (value === MISSING || value === undefined) {
    return false;
  }
  if (value === null) {
    return lookup.hasNull;
  }
  if (typeof value === "boolean") {
    return value ? lookup.hasTrue : lookup.hasFalse;
  }
  if (typeof value === "string") {
    return lookup.strings?.has(value) === true;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return false;
    }
    if (lookup.numbers?.has(value) === true) {
      return true;
    }
    if (lookup.bigints && Number.isInteger(value)) {
      return lookup.bigints.has(BigInt(value));
    }
    return false;
  }
  if (typeof value === "bigint") {
    if (lookup.bigints?.has(value) === true) {
      return true;
    }
    if (lookup.numbers) {
      const asNum = Number(value);
      if (Number.isFinite(asNum) && BigInt(asNum) === value && lookup.numbers.has(asNum)) {
        return true;
      }
    }
    return false;
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return !Number.isNaN(ts) && lookup.dates?.has(ts) === true;
  }
  for (let i = 0; i < lookup.fallback.length; i++) {
    if (valuesEqual(value, lookup.fallback[i])) {
      return true;
    }
  }
  return false;
}

class StringInNode implements MatcherNode {
  private readonly set: Set<string> | undefined;

  constructor(
    private readonly items: ReadonlyArray<string>,
    private readonly negate: boolean,
  ) {
    if (items.length >= IN_SET_THRESHOLD) {
      this.set = new Set(items);
    }
  }

  private containsString(v: unknown): boolean {
    if (typeof v !== "string") {
      return false;
    }
    if (this.set) {
      return this.set.has(v);
    }
    for (let i = 0, len = this.items.length; i < len; i++) {
      if (v === this.items[i]) {
        return true;
      }
    }
    return false;
  }

  match(record: unknown): boolean {
    let found = false;
    if (Array.isArray(record)) {
      for (let i = 0, len = record.length; i < len; i++) {
        if (this.containsString(record[i])) {
          found = true;
          break;
        }
      }
    } else {
      found = this.containsString(record);
    }
    return found !== this.negate;
  }

  priority(): number {
    const base = this.set ? 3 : 2 + Math.floor(this.items.length / 8);
    return this.negate ? base + 1 : base;
  }

  private label(): string {
    return `${this.negate ? "Nin" : "In"}(${formatValue(this.items)})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode("operator", this.label(), this.priority(), [], {
      order,
      operator: this.negate ? "$nin" : "$in",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceLeafTreeNode(this, record, "operator", this.label(), {
      order,
      operator: this.negate ? "$nin" : "$in",
    });
  }
}

class InNode implements MatcherNode {
  readonly lookup: InLookup | undefined;

  constructor(
    readonly items: ReadonlyArray<unknown>,
    readonly negate: boolean,
  ) {
    if (items.length >= IN_SET_THRESHOLD) {
      this.lookup = buildInLookup(items);
    }
  }

  contains(v: unknown): boolean {
    if (this.lookup) {
      return lookupContains(this.lookup, v);
    }
    for (let i = 0; i < this.items.length; i++) {
      if (valuesEqual(v, this.items[i])) {
        return true;
      }
    }
    return false;
  }

  match(record: unknown): boolean {
    let found = false;
    if (Array.isArray(record)) {
      for (let i = 0, len = record.length; i < len; i++) {
        if (this.contains(record[i])) {
          found = true;
          break;
        }
      }
    } else {
      found = this.contains(record);
    }
    return found !== this.negate;
  }

  priority(): number {
    const base = this.lookup
      ? 3 + Math.floor(this.lookup.fallback.length / 8)
      : 2 + Math.floor(this.items.length / 8);
    return this.negate ? base + 1 : base;
  }

  label(): string {
    return `${this.negate ? "Nin" : "In"}(${formatValue(this.items)})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode("operator", this.label(), this.priority(), [], {
      order,
      operator: this.negate ? "$nin" : "$in",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceLeafTreeNode(this, record, "operator", this.label(), {
      order,
      operator: this.negate ? "$nin" : "$in",
    });
  }
}

class InConvNode implements MatcherNode {
  constructor(
    private readonly base: InNode,
    private readonly cfg: CompileConfig,
  ) {}

  private contains(v: unknown): boolean {
    if (v === MISSING || v === undefined) {
      return false;
    }
    if (v !== null) {
      const converted = this.cfg.applyConverter(v);
      if (converted !== v) {
        return this.base.contains(converted);
      }
    }
    if (this.base.lookup && typeof v !== "object") {
      return lookupContains(this.base.lookup, v);
    }
    if (this.base.lookup) {
      if (lookupContains(this.base.lookup, v)) {
        return true;
      }
      for (let i = 0; i < this.base.lookup.fallback.length; i++) {
        if (valuesEqualConv(v, this.base.lookup.fallback[i], this.cfg)) {
          return true;
        }
      }
      return false;
    }
    for (let i = 0; i < this.base.items.length; i++) {
      if (valuesEqualConv(v, this.base.items[i], this.cfg)) {
        return true;
      }
    }
    return false;
  }

  match(record: unknown): boolean {
    let found = false;
    if (Array.isArray(record)) {
      for (let i = 0, len = record.length; i < len; i++) {
        if (this.contains(record[i])) {
          found = true;
          break;
        }
      }
    } else {
      found = this.contains(record);
    }
    return found !== this.base.negate;
  }

  priority(): number {
    return this.base.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    this.base.explain(lines, prefix, isLast, isRoot);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.base.label());
  }

  explainTree(order?: number): ExplainNode {
    return this.base.explainTree(order);
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceLeafTreeNode(this, record, "operator", this.base.label(), {
      order,
      operator: this.base.negate ? "$nin" : "$in",
    });
  }
}

function buildIn(operator: string, negate: boolean): OperatorBuilder {
  return (ctx: CompileContext, condition: unknown): MatcherNode => {
    if (!Array.isArray(condition)) {
      throw invalidCondition(`${operator} needs an array, got ${describeType(condition)}`);
    }
    ctx.addNode();
    if (!ctx.hasConverters() && condition.length > 0 && condition.every((x) => typeof x === "string")) {
      return new StringInNode(condition as string[], negate);
    }
    const base = new InNode(condition, negate);
    if (ctx.hasConverters()) {
      return new InConvNode(base, ctx.cfg);
    }
    return base;
  };
}

export function registerInclusionOperators(registry: Map<string, OperatorBuilder>): void {
  registry.set("$in", buildIn("$in", false));
  registry.set("$nin", buildIn("$nin", true));
}
