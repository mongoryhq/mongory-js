import { CompileContext, invalidCondition } from "../compile_ctx.js";
import { MatcherNode, makeExplainNode, traceLeaf, traceLeafTreeNode, writeTreeLine } from "../explain.js";
import { cloneStatelessRegExp, describeType } from "../normalize.js";
import { ExplainNode, TraceNode } from "../types.js";
import { ConvValueNode } from "./compare.js";

const VALID_OPTIONS = new Set(["i", "m", "s"]);

export class RegexNode implements MatcherNode {
  constructor(private readonly re: RegExp) {}

  match(record: unknown): boolean {
    return typeof record === "string" && this.re.test(record);
  }

  priority(): number {
    return this.re.source.startsWith("^") ? 8 : 20;
  }

  private label(): string {
    return `Regex(${this.re.toString()})`;
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
      operator: "$regex",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceLeafTreeNode(this, record, "operator", this.label(), {
      order,
      operator: "$regex",
    });
  }
}

export function parseRegexOptions(options: unknown): string {
  if (options === undefined) {
    return "";
  }
  if (typeof options !== "string") {
    throw invalidCondition(`$options needs a string, got ${describeType(options)}`);
  }
  let hasI = false;
  let hasM = false;
  let hasS = false;
  for (const ch of options) {
    if (!VALID_OPTIONS.has(ch)) {
      throw invalidCondition(`unsupported $options flag ${JSON.stringify(ch)}`);
    }
    if (ch === "i") hasI = true;
    if (ch === "m") hasM = true;
    if (ch === "s") hasS = true;
  }
  return `${hasI ? "i" : ""}${hasM ? "m" : ""}${hasS ? "s" : ""}`;
}

export function buildRegexNode(ctx: CompileContext, condition: unknown, options: unknown): MatcherNode {
  const flags = parseRegexOptions(options);
  let re: RegExp;

  if (condition instanceof RegExp) {
    if (flags !== "") {
      throw invalidCondition("$options cannot modify a compiled RegExp");
    }
    re = cloneStatelessRegExp(condition);
  } else if (typeof condition === "string") {
    try {
      re = new RegExp(condition, flags);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw invalidCondition(`$regex: ${msg}`);
    }
  } else {
    throw invalidCondition(`$regex needs a string or RegExp, got ${describeType(condition)}`);
  }

  const node = ctx.addNodeMatcher(new RegexNode(re));
  if (ctx.hasConverters()) {
    return new ConvValueNode(ctx.cfg, node);
  }
  return node;
}
