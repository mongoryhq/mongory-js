import { CompileContext, OperatorBuilder, invalidCondition } from "../compile_ctx.js";
import {
  MatcherNode,
  childPrefixFor,
  explainBranch,
  formatTraceValue,
  statusLabel,
  traceWrapped,
  writeTreeLine,
} from "../explain.js";
import { describeType } from "../normalize.js";
import { Condition, isPlainObject } from "../types.js";

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

class ArrayElementsNode implements MatcherNode {
  constructor(
    private readonly op: "ElemMatch" | "Every",
    private readonly inner: MatcherNode,
    private readonly stopOn: boolean,
  ) {}

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
}

class SizeNode implements MatcherNode {
  constructor(private readonly inner: MatcherNode) {}

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
