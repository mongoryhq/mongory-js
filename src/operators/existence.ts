import { CompileContext, OperatorBuilder, invalidCondition } from "../compile_ctx.js";
import { isPresent } from "../compare.js";
import { MatcherNode, traceLeaf, writeTreeLine } from "../explain.js";
import { describeType } from "../normalize.js";
import { MISSING } from "../types.js";
import { ConvValueNode } from "./compare.js";

class BoolOperatorNode implements MatcherNode {
  constructor(
    private readonly op: string,
    private readonly want: boolean,
    private readonly predicate: (record: unknown, want: boolean) => boolean,
  ) {}

  match(record: unknown): boolean {
    return this.predicate(record, this.want);
  }

  priority(): number {
    return 2;
  }

  private label(): string {
    return `${this.op}(${this.want})`;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, this.label());
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, this.label());
  }
}

function buildBoolOperator(
  operator: string,
  opLabel: string,
  useConverter: boolean,
  predicate: (record: unknown, want: boolean) => boolean,
): OperatorBuilder {
  return (ctx: CompileContext, condition: unknown): MatcherNode => {
    if (typeof condition !== "boolean") {
      throw invalidCondition(`${operator} needs a boolean, got ${describeType(condition)}`);
    }
    const node = ctx.addNodeMatcher(new BoolOperatorNode(opLabel, condition, predicate));
    if (useConverter && ctx.hasConverters()) {
      return new ConvValueNode(ctx.cfg, node);
    }
    return node;
  };
}

export function registerExistenceOperators(registry: Map<string, OperatorBuilder>): void {
  registry.set(
    "$exists",
    buildBoolOperator("$exists", "Exists", false, (record, want) => (record !== MISSING && record !== undefined) === want),
  );
  registry.set(
    "$present",
    buildBoolOperator("$present", "Present", true, (record, want) => isPresent(record) === want),
  );
}
