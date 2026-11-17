import { MatcherNode } from "./explain.js";
import { compileRoot } from "./node.js";
import { convertRootCondition } from "./normalize.js";
import { CompileOption, resolveCompileConfig } from "./options.js";
import { ConditionInput, TraceResult } from "./types.js";

/**
 * An immutable, compiled Mongory query matcher.
 *
 * `match`, `explain`, and `trace` are safe to pass unbound (e.g.
 * `records.filter(matcher.match)` or `records.some(matcher.match)`).
 */
export class Matcher {
  private readonly root: MatcherNode;

  private constructor(root: MatcherNode) {
    this.root = root;
  }

  /** @internal */
  static _fromRoot(root: MatcherNode): Matcher {
    return new Matcher(root);
  }

  /**
   * Reports whether `record` satisfies the compiled condition.
   */
  readonly match = (record: unknown): boolean => {
    return this.root.match(record);
  };

  /**
   * Returns a human-readable ASCII tree showing priority-ordered nodes.
   */
  readonly explain = (): string => {
    const lines: string[] = [];
    this.root.explain(lines, "", true, true);
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  };

  /**
   * Evaluates `record` and returns `{ matched, trace }` with per-node PASS/FAIL/SKIP status.
   */
  readonly trace = (record: unknown): TraceResult => {
    const lines: string[] = [];
    const matched = this.root.trace(record, lines, "", true, true);
    return {
      matched,
      trace: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    };
  };

  /**
   * Returns all records matching this matcher, preserving order.
   */
  filter<T>(records: Iterable<T>): T[] {
    return filter(records, this);
  }

  /**
   * Returns up to `limit` records matching this matcher, stopping early once `limit`
   * matches are found. `limit === 0` returns `[]`; `limit < 0` is unbounded.
   */
  filterLimit<T>(records: Iterable<T>, limit: number): T[] {
    return filterLimit(records, this, limit);
  }

  /**
   * Returns the first record matching this matcher, or `undefined`.
   */
  find<T>(records: Iterable<T>): T | undefined {
    return find(records, this);
  }

  /**
   * Reports whether any record in `records` matches this matcher.
   */
  any(records: Iterable<unknown>): boolean {
    return any(records, this);
  }

  /**
   * Returns the number of matching records in `records`.
   */
  count(records: Iterable<unknown>): number {
    return count(records, this);
  }
}

/**
 * Compiles a Mongory condition once into an immutable {@link Matcher}.
 */
export function compile(
  condition?: ConditionInput,
  ...options: Array<CompileOption | null | undefined>
): Matcher {
  const cfg = resolveCompileConfig(options);
  const doc = convertRootCondition(condition, cfg);
  const root = compileRoot(cfg, doc);
  return Matcher._fromRoot(root);
}

/**
 * Convenience one-shot compile and evaluate helper.
 */
export function match(
  condition: ConditionInput,
  record: unknown,
  ...options: Array<CompileOption | null | undefined>
): boolean {
  return compile(condition, ...options).match(record);
}

/**
 * Returns every element in `records` matching `matcher`, preserving order.
 */
export function filter<T>(records: Iterable<T>, matcher: Matcher): T[] {
  const out: T[] = [];
  for (const r of records) {
    if (matcher.match(r)) {
      out.push(r);
    }
  }
  return out;
}

/**
 * Returns up to `limit` elements in `records` matching `matcher`, stopping early.
 * `limit === 0` or `NaN` returns `[]`; negative `limit` returns all matches.
 */
export function filterLimit<T>(records: Iterable<T>, matcher: Matcher, limit: number): T[] {
  if (limit === 0 || Number.isNaN(limit)) {
    return [];
  }
  if (limit < 0 || !Number.isFinite(limit)) {
    return filter(records, matcher);
  }
  const max = Math.trunc(limit);
  if (max <= 0) {
    return [];
  }
  const out: T[] = [];
  for (const r of records) {
    if (matcher.match(r)) {
      out.push(r);
      if (out.length >= max) {
        return out;
      }
    }
  }
  return out;
}

/**
 * Returns the first element in `records` matching `matcher`, or `undefined`.
 */
export function find<T>(records: Iterable<T>, matcher: Matcher): T | undefined {
  for (const r of records) {
    if (matcher.match(r)) {
      return r;
    }
  }
  return undefined;
}

/**
 * Reports whether at least one element in `records` matches `matcher`.
 */
export function any(records: Iterable<unknown>, matcher: Matcher): boolean {
  for (const r of records) {
    if (matcher.match(r)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the number of elements in `records` matching `matcher`.
 */
export function count(records: Iterable<unknown>, matcher: Matcher): number {
  let n = 0;
  for (const r of records) {
    if (matcher.match(r)) {
      n++;
    }
  }
  return n;
}
