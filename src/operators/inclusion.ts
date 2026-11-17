import { CompileContext, OperatorBuilder, invalidCondition } from "../compile_ctx.js";
import { valuesEqual } from "../compare.js";
import { MatcherNode, formatValue, traceLeaf, writeTreeLine } from "../explain.js";
import { describeType } from "../normalize.js";
import { CompileConfig } from "../options.js";
import { MISSING } from "../types.js";
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

function matchInElements(record: unknown, containsFn: (v: unknown) => boolean, negate: boolean): boolean {
  let found = false;
  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i++) {
      if (containsFn(record[i])) {
        found = true;
        break;
      }
    }
  } else {
    found = containsFn(record);
  }
  return found !== negate;
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
    return matchInElements(record, (v) => this.contains(v), this.negate);
  }

  priority(): number {
    if (this.lookup) {
      return 3 + Math.floor(this.lookup.fallback.length / 8);
    }
    return 2 + Math.floor(this.items.length / 8);
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
    return matchInElements(record, (v) => this.contains(v), this.base.negate);
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
}

function buildIn(operator: string, negate: boolean): OperatorBuilder {
  return (ctx: CompileContext, condition: unknown): MatcherNode => {
    if (!Array.isArray(condition)) {
      throw invalidCondition(`${operator} needs an array, got ${describeType(condition)}`);
    }
    ctx.addNode();
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
