import { MatcherNode } from "./explain.js";
import { compileRoot } from "./node.js";
import { convertRootCondition } from "./normalize.js";
import { CompileOption, resolveCompileConfig } from "./options.js";
import { ConditionInput, ExplainNode, TraceResult, TraceTreeResult } from "./types.js";

/**
 * An immutable, compiled Mongory query matcher.
 *
 * `match`, `explain`, `explainTree`, `trace`, and `traceTree` are safe to pass unbound (e.g.
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
   * Returns a structured compiled AST tree ordered by evaluation priority.
   */
  readonly explainTree = (): ExplainNode => {
    return this.root.explainTree();
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
   * Evaluates `record` and returns `{ matched, tree }` with structured per-node PASS/FAIL/SKIP status.
   */
  readonly traceTree = (record: unknown): TraceTreeResult => {
    const tree = this.root.traceTree(record);
    return {
      matched: tree.status === "PASS",
      tree,
    };
  };

  /**
   * Returns all records matching this matcher, preserving order.
   */
  filter<T>(records: Iterable<T>): T[] {
    const out: T[] = [];
    if (Array.isArray(records)) {
      const root = this.root;
      for (let i = 0, len = records.length; i < len; i++) {
        const r = records[i];
        if (root.match(r)) {
          out.push(r);
        }
      }
      return out;
    }
    for (const r of records) {
      if (this.root.match(r)) {
        out.push(r);
      }
    }
    return out;
  }

  /**
   * Returns up to `limit` records matching this matcher, stopping early once `limit`
   * matches are found. `limit === 0` or `NaN` returns `[]`; `limit < 0` is unbounded.
   */
  filterLimit<T>(records: Iterable<T>, limit: number): T[] {
    if (limit === 0 || Number.isNaN(limit)) {
      return [];
    }
    if (limit < 0 || !Number.isFinite(limit)) {
      return this.filter(records);
    }
    const max = Math.trunc(limit);
    if (max <= 0) {
      return [];
    }
    const out: T[] = [];
    if (Array.isArray(records)) {
      const root = this.root;
      for (let i = 0, len = records.length; i < len; i++) {
        const r = records[i];
        if (root.match(r)) {
          out.push(r);
          if (out.length >= max) {
            return out;
          }
        }
      }
      return out;
    }
    for (const r of records) {
      if (this.root.match(r)) {
        out.push(r);
        if (out.length >= max) {
          return out;
        }
      }
    }
    return out;
  }

  /**
   * Returns the first record matching this matcher, or `undefined`.
   */
  find<T>(records: Iterable<T>): T | undefined {
    if (Array.isArray(records)) {
      const root = this.root;
      for (let i = 0, len = records.length; i < len; i++) {
        const r = records[i];
        if (root.match(r)) {
          return r;
        }
      }
      return undefined;
    }
    for (const r of records) {
      if (this.root.match(r)) {
        return r;
      }
    }
    return undefined;
  }

  /**
   * Reports whether any record in `records` matches this matcher.
   */
  any(records: Iterable<unknown>): boolean {
    if (Array.isArray(records)) {
      const root = this.root;
      for (let i = 0, len = records.length; i < len; i++) {
        if (root.match(records[i])) {
          return true;
        }
      }
      return false;
    }
    for (const r of records) {
      if (this.root.match(r)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the number of matching records in `records`.
   */
  count(records: Iterable<unknown>): number {
    let n = 0;
    if (Array.isArray(records)) {
      const root = this.root;
      for (let i = 0, len = records.length; i < len; i++) {
        if (root.match(records[i])) {
          n++;
        }
      }
      return n;
    }
    for (const r of records) {
      if (this.root.match(r)) {
        n++;
      }
    }
    return n;
  }
}

/**
 * Compiles a Mongory condition once into an immutable {@link Matcher}.
 */
export function compileMatcher(
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
export function matchCondition(
  condition: ConditionInput,
  record: unknown,
  ...options: Array<CompileOption | null | undefined>
): boolean {
  return compileMatcher(condition, ...options).match(record);
}
