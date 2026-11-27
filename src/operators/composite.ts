import { CompileContext, OperatorBuilder, invalidCondition, sortByPriority } from "../compile_ctx.js";
import {
  MatcherNode,
  PriorityParent,
  explainBranch,
  explainGroupTree,
  makeExplainNode,
  traceGroup,
  traceGroupTree,
  traceWrapped,
  traceWrappedTree,
  writeTreeLine,
} from "../explain.js";
import { describeType } from "../normalize.js";
import { Condition, ExplainNode, TraceNode, isPlainObject } from "../types.js";

function resortGroupChildren(children: ReadonlyArray<MatcherNode>): ReadonlyArray<MatcherNode> {
  if (children.length <= 1) {
    return children;
  }
  const next = children.slice();
  sortByPriority(next);
  return next;
}

export class AllOfNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;
  private _children: ReadonlyArray<MatcherNode>;

  constructor(children: ReadonlyArray<MatcherNode>) {
    this._children = children;
    for (let i = 0; i < children.length; i++) {
      children[i].setParent?.(this);
    }
  }

  get children(): ReadonlyArray<MatcherNode> {
    return this._children;
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this._children = resortGroupChildren(this._children);
    this.parent?.onChildPriorityChanged();
  }

  match(record: unknown): boolean {
    const children = this._children;
    for (let i = 0; i < children.length; i++) {
      if (!children[i].match(record)) {
        return false;
      }
    }
    return true;
  }

  priority(): number {
    const children = this._children;
    let total = 1;
    for (let i = 0; i < children.length; i++) {
      total += children[i].priority();
    }
    return total;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    const children = this._children;
    if (children.length === 0) {
      writeTreeLine(lines, prefix, isLast, isRoot, "And (empty)");
      return;
    }
    explainBranch(lines, prefix, isLast, isRoot, "And", children);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceGroup(record, lines, prefix, isLast, isRoot, "And", this._children, false);
  }

  explainTree(order?: number): ExplainNode {
    return explainGroupTree(this, "and", "And", "$and", this._children, order);
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceGroupTree(this, record, "and", "And", "$and", this._children, false, order);
  }
}

export class AnyOfNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;
  private _children: ReadonlyArray<MatcherNode>;

  constructor(children: ReadonlyArray<MatcherNode>) {
    this._children = children;
    for (let i = 0; i < children.length; i++) {
      children[i].setParent?.(this);
    }
  }

  get children(): ReadonlyArray<MatcherNode> {
    return this._children;
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this._children = resortGroupChildren(this._children);
    this.parent?.onChildPriorityChanged();
  }

  match(record: unknown): boolean {
    const children = this._children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].match(record)) {
        return true;
      }
    }
    return false;
  }

  priority(): number {
    const children = this._children;
    let total = 1;
    for (let i = 0; i < children.length; i++) {
      total += children[i].priority();
    }
    return total;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    const children = this._children;
    if (children.length === 0) {
      writeTreeLine(lines, prefix, isLast, isRoot, "Or (empty)");
      return;
    }
    explainBranch(lines, prefix, isLast, isRoot, "Or", children);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceGroup(record, lines, prefix, isLast, isRoot, "Or", this._children, true);
  }

  explainTree(order?: number): ExplainNode {
    return explainGroupTree(this, "or", "Or", "$or", this._children, order);
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceGroupTree(this, record, "or", "Or", "$or", this._children, true, order);
  }
}

export class NoneOfNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;
  private _children: ReadonlyArray<MatcherNode>;

  constructor(children: ReadonlyArray<MatcherNode>) {
    this._children = children;
    for (let i = 0; i < children.length; i++) {
      children[i].setParent?.(this);
    }
  }

  get children(): ReadonlyArray<MatcherNode> {
    return this._children;
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this._children = resortGroupChildren(this._children);
    this.parent?.onChildPriorityChanged();
  }

  match(record: unknown): boolean {
    const children = this._children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].match(record)) {
        return false;
      }
    }
    return true;
  }

  priority(): number {
    const children = this._children;
    let total = 2;
    for (let i = 0; i < children.length; i++) {
      total += children[i].priority();
    }
    return total;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    const children = this._children;
    if (children.length === 0) {
      writeTreeLine(lines, prefix, isLast, isRoot, "Nor (empty)");
      return;
    }
    explainBranch(lines, prefix, isLast, isRoot, "Nor", children);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceGroup(record, lines, prefix, isLast, isRoot, "Nor", this._children, true, true);
  }

  explainTree(order?: number): ExplainNode {
    return explainGroupTree(this, "nor", "Nor", "$nor", this._children, order);
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceGroupTree(this, record, "nor", "Nor", "$nor", this._children, true, order, true);
  }
}

class NotNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;

  constructor(private readonly inner: MatcherNode) {
    inner.setParent?.(this);
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this.parent?.onChildPriorityChanged();
  }

  match(record: unknown): boolean {
    return !this.inner.match(record);
  }

  priority(): number {
    return 2 + this.inner.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    explainBranch(lines, prefix, isLast, isRoot, "Not", [this.inner]);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceWrapped(record, lines, prefix, isLast, isRoot, "Not", this.inner, true);
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode("not", "Not", this.priority(), [this.inner.explainTree()], {
      order,
      operator: "$not",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceWrappedTree(this, record, "not", "Not", this.inner, true, {
      order,
      operator: "$not",
    });
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

  registry.set("$nor", (ctx, condition) => {
    const children = buildConditionList(ctx, "$nor", condition);
    return new NoneOfNode(children);
  });

  registry.set("$not", (ctx, condition) => {
    ctx.addNode();
    const inner = ctx.hooks.buildLiteral(ctx, condition);
    return new NotNode(inner);
  });
}
