import { CompileContext, OperatorBuilder, invalidCondition, sortByPriority } from "../compile_ctx.js";
import { MatcherNode, explainBranch, traceGroup, traceWrapped, writeTreeLine } from "../explain.js";
import { describeType } from "../normalize.js";
import { Condition, isPlainObject } from "../types.js";

export class AllOfNode implements MatcherNode {
  constructor(readonly children: ReadonlyArray<MatcherNode>) {}

  match(record: unknown): boolean {
    for (let i = 0; i < this.children.length; i++) {
      if (!this.children[i].match(record)) {
        return false;
      }
    }
    return true;
  }

  priority(): number {
    let total = 1;
    for (let i = 0; i < this.children.length; i++) {
      total += this.children[i].priority();
    }
    return total;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    if (this.children.length === 0) {
      writeTreeLine(lines, prefix, isLast, isRoot, "And (empty)");
      return;
    }
    explainBranch(lines, prefix, isLast, isRoot, "And", this.children);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceGroup(record, lines, prefix, isLast, isRoot, "And", this.children, false);
  }
}

export class AnyOfNode implements MatcherNode {
  constructor(readonly children: ReadonlyArray<MatcherNode>) {}

  match(record: unknown): boolean {
    for (let i = 0; i < this.children.length; i++) {
      if (this.children[i].match(record)) {
        return true;
      }
    }
    return false;
  }

  priority(): number {
    let total = 1;
    for (let i = 0; i < this.children.length; i++) {
      total += this.children[i].priority();
    }
    return total;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    if (this.children.length === 0) {
      writeTreeLine(lines, prefix, isLast, isRoot, "Or (empty)");
      return;
    }
    explainBranch(lines, prefix, isLast, isRoot, "Or", this.children);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceGroup(record, lines, prefix, isLast, isRoot, "Or", this.children, true);
  }
}

class NotNode implements MatcherNode {
  constructor(private readonly inner: MatcherNode) {}

  match(record: unknown): boolean {
    return !this.inner.match(record);
  }

  priority(): number {
    return 1 + this.inner.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    explainBranch(lines, prefix, isLast, isRoot, "Not", [this.inner]);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceWrapped(record, lines, prefix, isLast, isRoot, "Not", this.inner, true);
  }
}

function buildConditionList(ctx: CompileContext, operator: string, condition: unknown): MatcherNode[] {
  if (!Array.isArray(condition)) {
    throw invalidCondition(`${operator} needs an array, got ${describeType(condition)}`);
  }
  ctx.addNode();
  const children: MatcherNode[] = [];
  for (let i = 0; i < condition.length; i++) {
    const item = condition[i];
    if (!isPlainObject(item)) {
      throw invalidCondition(`${operator} needs an array of objects, got ${describeType(item)}`);
    }
    children.push(ctx.hooks.buildHashCondition(ctx, item as Condition));
  }
  sortByPriority(children);
  return children;
}

export function registerCompositeOperators(registry: Map<string, OperatorBuilder>): void {
  registry.set("$and", (ctx, condition) => {
    const children = buildConditionList(ctx, "$and", condition);
    const flat: MatcherNode[] = [];
    for (const child of children) {
      if (child instanceof AllOfNode) {
        for (const sub of child.children) {
          flat.push(sub);
        }
      } else {
        flat.push(child);
      }
    }
    sortByPriority(flat);
    return new AllOfNode(flat);
  });

  registry.set("$or", (ctx, condition) => {
    const children = buildConditionList(ctx, "$or", condition);
    return new AnyOfNode(children);
  });

  registry.set("$not", (ctx, condition) => {
    ctx.addNode();
    const inner = ctx.hooks.buildLiteral(ctx, condition);
    return new NotNode(inner);
  });
}
