import { CompileContext, invalidCondition } from "../compile_ctx.js";
import { MatcherNode, formatValue, traceLeaf, writeTreeLine } from "../explain.js";
import { CustomOperator, MISSING, Predicate } from "../types.js";

export class CustomOpNode implements MatcherNode {
  private readonly priorityWeight: number;

  constructor(
    private readonly name: string,
    private readonly arg: unknown,
    private readonly pred: Predicate,
    priorityHint?: number,
  ) {
    this.priorityWeight = priorityHint !== undefined && priorityHint > 0 ? priorityHint : 3;
  }

  match(record: unknown): boolean {
    if (record === MISSING) {
      return this.pred(undefined, false);
    }
    return this.pred(record, true);
  }

  priority(): number {
    return this.priorityWeight;
  }

  private label(): string {
    return `${this.name}(${formatValue(this.arg)})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }
}

export function buildCustomOpNode(
  ctx: CompileContext,
  name: string,
  op: CustomOperator,
  arg: unknown,
): MatcherNode {
  ctx.addNode();
  let pred: Predicate;
  try {
    pred = op.compile(arg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw invalidCondition(`${name}: ${msg}`);
  }
  if (typeof pred !== "function") {
    throw invalidCondition(`${name}: compile returned non-function predicate`);
  }
  return new CustomOpNode(name, arg, pred, op.priority);
}
