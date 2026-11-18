import { CompileContext, OperatorBuilder, invalidCondition } from "../compile_ctx.js";
import {
  MatcherNode,
  PriorityParent,
  childPrefixFor,
  explainBranch,
  formatTraceValue,
  makeExplainNode,
  makeTraceNode,
  markTreeSkipped,
  snapshotTraceValue,
  statusLabel,
  traceWrapped,
  traceWrappedTree,
  writeTreeLine,
} from "../explain.js";
import { describeType } from "../normalize.js";
import { Condition, ExplainNode, TraceNode, isPlainObject } from "../types.js";

function traceArrayElements(
  record: unknown,
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  op: "ElemMatch" | "Every",
  inner: MatcherNode,
  stopOn: boolean,
): boolean {
  if (!Array.isArray(record) || record.length === 0) {
    writeTreeLine(lines, prefix, isLast, isRoot, `[FAIL] ${op} | value=${formatTraceValue(record)}`);
    return false;
  }
  const childPrefix = childPrefixFor(prefix, isLast, isRoot);
  const childLines: string[] = [];
  let matched = !stopOn;

  for (let i = 0; i < record.length; i++) {
    const elem = record[i];
    const elemLast = i === record.length - 1;
    const elemChildPrefix = childPrefixFor(childPrefix, elemLast, false);
    const elemLines: string[] = [];
    const res = inner.trace(elem, elemLines, elemChildPrefix, true, false);
    writeTreeLine(
      childLines,
      childPrefix,
      elemLast,
      false,
      `[${statusLabel(res)}] [${i}] | value=${formatTraceValue(elem)}`,
    );
    for (const l of elemLines) {
      childLines.push(l);
    }
    if (res === stopOn) {
      matched = stopOn;
      const rem = record.length - i - 1;
      if (rem > 0) {
        writeTreeLine(
          childLines,
          childPrefix,
          true,
          false,
          `[SKIP] ${rem} remaining element(s) (short-circuited)`,
        );
      }
      break;
    }
  }

  writeTreeLine(lines, prefix, isLast, isRoot, `[${statusLabel(matched)}] ${op} | value=${formatTraceValue(record)}`);
  for (const l of childLines) {
    lines.push(l);
  }
  return matched;
}

class ArrayElementsNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;

  constructor(
    private readonly op: "ElemMatch" | "Every",
    private readonly inner: MatcherNode,
    private readonly stopOn: boolean,
  ) {
    inner.setParent?.(this);
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this.parent?.onChildPriorityChanged();
  }

  match(record: unknown): boolean {
    if (!Array.isArray(record) || record.length === 0) {
      return false;
    }
    for (let i = 0; i < record.length; i++) {
      if (this.inner.match(record[i]) === this.stopOn) {
        return this.stopOn;
      }
    }
    return !this.stopOn;
  }

  priority(): number {
    return 3 + this.inner.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    explainBranch(lines, prefix, isLast, isRoot, this.op, [this.inner]);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceArrayElements(record, lines, prefix, isLast, isRoot, this.op, this.inner, this.stopOn);
  }

  private nodeKind(): "elemMatch" | "every" {
    return this.op === "ElemMatch" ? "elemMatch" : "every";
  }

  private opName(): "$elemMatch" | "$every" {
    return this.op === "ElemMatch" ? "$elemMatch" : "$every";
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode(this.nodeKind(), this.op, this.priority(), [this.inner.explainTree()], {
      order,
      operator: this.opName(),
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    const kind = this.nodeKind();
    const operator = this.opName();
    if (!Array.isArray(record) || record.length === 0) {
      const reason = Array.isArray(record) ? "empty-array" : "non-array";
      return makeTraceNode(
        kind,
        false,
        this.op,
        this.priority(),
        record,
        [markTreeSkipped(this.inner.explainTree(), reason)],
        { order, operator, detail: reason },
      );
    }

    const childTrees: TraceNode[] = [];
    let matched = !this.stopOn;

    for (let i = 0; i < record.length; i++) {
      const elem = record[i];
      const elemTree = this.inner.traceTree(elem);
      const passed = elemTree.status === "PASS";
      childTrees.push({
        kind: "element",
        status: statusLabel(passed),
        label: `[${i}]`,
        priority: elemTree.priority,
        index: i,
        valueText: formatTraceValue(elem),
        value: snapshotTraceValue(elem),
        exists: true,
        children: [elemTree],
      });
      if (passed === this.stopOn) {
        matched = this.stopOn;
        const rem = record.length - i - 1;
        if (rem > 0) {
          childTrees.push({
            kind: "skip",
            status: "SKIP",
            label: `${rem} remaining element(s) (short-circuited)`,
            priority: this.inner.priority(),
            skippedCount: rem,
            detail: "short-circuited",
            children: [],
          });
        }
        break;
      }
    }

    return makeTraceNode(kind, matched, this.op, this.priority(), record, childTrees, {
      order,
      operator,
    });
  }
}

class SizeNode implements MatcherNode, PriorityParent {
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
    return Array.isArray(record) && this.inner.match(record.length);
  }

  priority(): number {
    return 2 + this.inner.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    explainBranch(lines, prefix, isLast, isRoot, "Size", [this.inner]);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    if (!Array.isArray(record)) {
      writeTreeLine(lines, prefix, isLast, isRoot, `[FAIL] Size | value=${formatTraceValue(record)}`);
      return false;
    }
    return traceWrapped(record.length, lines, prefix, isLast, isRoot, `Size(len=${record.length})`, this.inner, false);
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode("size", "Size", this.priority(), [this.inner.explainTree()], {
      order,
      operator: "$size",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    if (!Array.isArray(record)) {
      return makeTraceNode(
        "size",
        false,
        "Size",
        this.priority(),
        record,
        [markTreeSkipped(this.inner.explainTree(), "non-array")],
        { order, operator: "$size", detail: "non-array" },
      );
    }
    return traceWrappedTree(
      this,
      record.length,
      "size",
      `Size(len=${record.length})`,
      this.inner,
      false,
      { order, operator: "$size" },
    );
  }
}

function buildElementCondition(ctx: CompileContext, operator: string, condition: unknown): MatcherNode {
  if (!isPlainObject(condition)) {
    throw invalidCondition(`${operator} needs an object, got ${describeType(condition)}`);
  }
  ctx.addNode();
  return ctx.hooks.buildHashCondition(ctx, condition as Condition);
}

export function buildElemMatchNode(ctx: CompileContext, condition: unknown): MatcherNode {
  const inner = buildElementCondition(ctx, "$elemMatch", condition);
  return new ArrayElementsNode("ElemMatch", inner, true);
}

export function registerArrayOperators(registry: Map<string, OperatorBuilder>): void {
  registry.set("$elemMatch", buildElemMatchNode);
  registry.set("$every", (ctx, condition) => {
    const inner = buildElementCondition(ctx, "$every", condition);
    return new ArrayElementsNode("Every", inner, false);
  });
  registry.set("$size", (ctx, condition) => {
    ctx.addNode();
    const inner = ctx.hooks.buildLiteral(ctx, condition);
    return new SizeNode(inner);
  });
}
