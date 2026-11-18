import { CompileContext, OperatorBuilder, TreeBuilderHooks, invalidCondition, sortByPriority } from "./compile_ctx.js";
import {
  MatcherNode,
  PriorityParent,
  explainBranch,
  formatTraceValue,
  makeExplainNode,
  makeTraceNode,
  markTreeSkipped,
  traceLeaf,
  traceLeafTreeNode,
  traceWrapped,
  traceWrappedTree,
  writeTreeLine,
} from "./explain.js";
import { cloneStatelessRegExp } from "./normalize.js";
import { CompileConfig } from "./options.js";
import { buildElemMatchNode, registerArrayOperators } from "./operators/array.js";
import { ConvValueNode, EqConvNode, EqNode, buildEqNode } from "./operators/compare.js";
import { registerCompareOperators } from "./operators/compare.js";
import { AllOfNode, AnyOfNode, registerCompositeOperators } from "./operators/composite.js";
import { buildCustomOpNode } from "./operators/custom.js";
import { registerExistenceOperators } from "./operators/existence.js";
import { registerInclusionOperators } from "./operators/inclusion.js";
import { RegexNode, buildRegexNode } from "./operators/regex.js";
import {
  Condition,
  ExplainNode,
  MISSING,
  TraceNode,
  isPlainObject,
  parseIndexKey,
  setOwnProp,
  sortedOwnKeys,
} from "./types.js";

const BUILTIN_BUILDERS: ReadonlyMap<string, OperatorBuilder> = (() => {
  const map = new Map<string, OperatorBuilder>();
  registerCompareOperators(map);
  registerInclusionOperators(map);
  registerExistenceOperators(map);
  registerCompositeOperators(map);
  registerArrayOperators(map);
  return map;
})();

const ELEMENT_OPERATORS = new Set(["$gt", "$gte", "$lt", "$lte", "$regex"]);

class NullNode implements MatcherNode {
  match(record: unknown): boolean {
    return record === null || record === undefined || record === MISSING;
  }

  priority(): number {
    return 2;
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    writeTreeLine(lines, prefix, isLast, isRoot, "Eq(nil) | NotExists");
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    return traceLeaf(this, record, lines, prefix, isLast, isRoot, "Eq(nil) | NotExists");
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode("operator", "Eq(nil) | NotExists", this.priority(), [], {
      order,
      operator: "$eq",
    });
  }

  traceTree(record: unknown, order?: number): TraceNode {
    return traceLeafTreeNode(this, record, "operator", "Eq(nil) | NotExists", {
      order,
      operator: "$eq",
    });
  }
}

class FieldNode implements MatcherNode, PriorityParent {
  private parent?: PriorityParent;

  constructor(
    protected readonly field: string,
    protected readonly index: number | undefined,
    protected readonly literal: MatcherNode,
  ) {
    literal.setParent?.(this);
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this.parent?.onChildPriorityChanged();
  }

  protected extract(record: unknown): unknown | typeof INVALID_CONTAINER {
    if (record === null || record === undefined || record === MISSING || typeof record !== "object") {
      return INVALID_CONTAINER;
    }
    if (Array.isArray(record)) {
      if (this.index !== undefined) {
        let idx = this.index;
        if (idx < 0) {
          idx += record.length;
        }
        if (idx >= 0 && idx < record.length) {
          return record[idx];
        }
      }
      return MISSING;
    }
    const proto = Object.getPrototypeOf(record);
    if (proto !== Object.prototype && proto !== null) {
      if (
        record instanceof Date ||
        record instanceof RegExp ||
        ArrayBuffer.isView(record) ||
        record instanceof ArrayBuffer ||
        record instanceof Map ||
        record instanceof Set
      ) {
        return INVALID_CONTAINER;
      }
    }
    if (Object.hasOwn(record, this.field)) {
      const val = (record as Record<string, unknown>)[this.field];
      return val === undefined ? MISSING : val;
    }
    return MISSING;
  }

  match(record: unknown): boolean {
    const val = this.extract(record);
    if (val === INVALID_CONTAINER) {
      return false;
    }
    return this.literal.match(val);
  }

  priority(): number {
    return 1 + this.literal.priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    explainBranch(lines, prefix, isLast, isRoot, `Field(${JSON.stringify(this.field)})`, [this.literal]);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    const val = this.extract(record);
    if (val === INVALID_CONTAINER) {
      writeTreeLine(
        lines,
        prefix,
        isLast,
        isRoot,
        `[FAIL] Field(${JSON.stringify(this.field)}) | value=${formatTraceValue(record)}`,
      );
      return false;
    }
    return traceWrapped(val, lines, prefix, isLast, isRoot, `Field(${JSON.stringify(this.field)})`, this.literal, false);
  }

  explainTree(order?: number): ExplainNode {
    return makeExplainNode(
      "field",
      `Field(${JSON.stringify(this.field)})`,
      this.priority(),
      [this.literal.explainTree()],
      { order, field: this.field },
    );
  }

  traceTree(record: unknown, order?: number): TraceNode {
    const label = `Field(${JSON.stringify(this.field)})`;
    const val = this.extract(record);
    if (val === INVALID_CONTAINER) {
      return makeTraceNode(
        "field",
        false,
        label,
        this.priority(),
        record,
        [markTreeSkipped(this.literal.explainTree(), "non-container")],
        { order, field: this.field, detail: "non-container" },
      );
    }
    return traceWrappedTree(this, val, "field", label, this.literal, false, {
      order,
      field: this.field,
    });
  }
}

const INVALID_CONTAINER = Symbol("mongory.invalidContainer");

class ExtFieldNode extends FieldNode {
  constructor(
    field: string,
    index: number | undefined,
    literal: MatcherNode,
    private readonly cfg: CompileConfig,
  ) {
    super(field, index, literal);
  }

  protected override extract(record: unknown): unknown | typeof INVALID_CONTAINER {
    if (record !== null && record !== undefined && record !== MISSING && typeof record === "object" && !Array.isArray(record)) {
      const custom = this.cfg.resolveCustomField(record, this.field);
      if (custom.handled) {
        return custom.value;
      }
    }
    return super.extract(record);
  }
}

class LiteralNode implements MatcherNode, PriorityParent {
  protected arrayRecord: MatcherNode | undefined;
  private parent?: PriorityParent;

  constructor(
    protected readonly condition: unknown,
    protected readonly dispatched: MatcherNode,
  ) {
    dispatched.setParent?.(this);
  }

  setParent(parent: PriorityParent): void {
    this.parent = parent;
  }

  onChildPriorityChanged(): void {
    this.parent?.onChildPriorityChanged();
  }

  protected installArrayRecord(build: () => MatcherNode): MatcherNode {
    if (!this.arrayRecord) {
      const prevPriority = this.priority();
      const built = build();
      built.setParent?.(this);
      this.arrayRecord = built;
      if (this.priority() !== prevPriority) {
        this.parent?.onChildPriorityChanged();
      }
    }
    return this.arrayRecord;
  }

  protected ensureArrayRecord(): MatcherNode {
    return this.installArrayRecord(() => buildArrayRecord(this.condition, undefined));
  }

  match(record: unknown): boolean {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().match(record);
    }
    return this.dispatched.match(record);
  }

  priority(): number {
    return 1 + (this.arrayRecord ?? this.dispatched).priority();
  }

  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void {
    (this.arrayRecord ?? this.dispatched).explain(lines, prefix, isLast, isRoot);
  }

  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().trace(record, lines, prefix, isLast, isRoot);
    }
    return this.dispatched.trace(record, lines, prefix, isLast, isRoot);
  }

  explainTree(order?: number): ExplainNode {
    return (this.arrayRecord ?? this.dispatched).explainTree(order);
  }

  traceTree(record: unknown, order?: number): TraceNode {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().traceTree(record, order);
    }
    return this.dispatched.traceTree(record, order);
  }
}

class ExtLiteralNode extends LiteralNode {
  constructor(
    condition: unknown,
    dispatched: MatcherNode,
    private readonly arrayCtx: CompileContext,
    private readonly convertArrayContainer: boolean,
  ) {
    super(condition, dispatched);
  }

  protected override ensureArrayRecord(): MatcherNode {
    return this.installArrayRecord(() => buildArrayRecord(this.condition, this.arrayCtx));
  }

  override match(record: unknown): boolean {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().match(record);
    }
    if (this.convertArrayContainer && record !== null && typeof record === "object") {
      const converted = this.arrayCtx.cfg.applyConverter(record);
      if (Array.isArray(converted)) {
        return this.ensureArrayRecord().match(converted);
      }
    }
    return this.dispatched.match(record);
  }

  override trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().trace(record, lines, prefix, isLast, isRoot);
    }
    if (this.convertArrayContainer && record !== null && typeof record === "object") {
      const converted = this.arrayCtx.cfg.applyConverter(record);
      if (Array.isArray(converted)) {
        return this.ensureArrayRecord().trace(converted, lines, prefix, isLast, isRoot);
      }
    }
    return this.dispatched.trace(record, lines, prefix, isLast, isRoot);
  }

  override traceTree(record: unknown, order?: number): TraceNode {
    if (Array.isArray(record)) {
      return this.ensureArrayRecord().traceTree(record, order);
    }
    if (this.convertArrayContainer && record !== null && typeof record === "object") {
      const converted = this.arrayCtx.cfg.applyConverter(record);
      if (Array.isArray(converted)) {
        return this.ensureArrayRecord().traceTree(converted, order);
      }
    }
    return this.dispatched.traceTree(record, order);
  }
}

function buildFieldNode(ctx: CompileContext, field: string, condition: unknown): MatcherNode {
  ctx.addNode();
  const literal = buildLiteral(ctx, condition);
  const index = parseIndexKey(field);
  if (ctx.cfg.hasFieldHooks()) {
    return new ExtFieldNode(field, index, literal, ctx.cfg);
  }
  return new FieldNode(field, index, literal);
}

export function buildLiteral(ctx: CompileContext, condition: unknown): MatcherNode {
  let dispatched: MatcherNode;
  if (isPlainObject(condition)) {
    dispatched = buildHashCondition(ctx, condition as Condition);
  } else if (condition instanceof RegExp) {
    const node = ctx.addNodeMatcher(new RegexNode(cloneStatelessRegExp(condition)));
    dispatched = ctx.hasConverters() ? new ConvValueNode(ctx.cfg, node) : node;
  } else if (condition === null || condition === undefined) {
    const node = ctx.addNodeMatcher(new NullNode());
    dispatched = ctx.hasConverters() ? new ConvValueNode(ctx.cfg, node, "Eq(nil) | NotExists") : node;
  } else {
    dispatched = buildEqNode(ctx, condition, false);
  }
  const extCtx = ctx.withoutLimits();
  if (!extCtx) {
    return new LiteralNode(condition, dispatched);
  }
  const convertArrayContainer = extCtx.hasConverters() && extCtx.cfg.customOperators.size === 0;
  return new ExtLiteralNode(condition, dispatched, extCtx, convertArrayContainer);
}

export function buildHashCondition(ctx: CompileContext, condition: Condition): MatcherNode {
  const children: MatcherNode[] = [];
  let rawCount = 0;

  for (const key of sortedOwnKeys(condition)) {
    const customOp = ctx.cfg.customOperators.get(key);
    const builtinBuilder = ctx.builders.get(key);
    let child: MatcherNode | undefined;

    if (customOp) {
      const prev = ctx.enter();
      try {
        child = buildCustomOpNode(ctx, key, customOp, condition[key]);
      } finally {
        ctx.leave(prev);
      }
    } else if (key === "$options") {
      if (Object.hasOwn(condition, "$regex")) {
        continue;
      }
      throw invalidCondition("$options needs a sibling $regex");
    } else if (key === "$regex") {
      const prev = ctx.enter();
      try {
        const opts = Object.hasOwn(condition, "$options") ? condition.$options : undefined;
        child = buildRegexNode(ctx, condition[key], opts);
      } finally {
        ctx.leave(prev);
      }
    } else if (builtinBuilder) {
      const prev = ctx.enter();
      try {
        child = builtinBuilder(ctx, condition[key]);
      } finally {
        ctx.leave(prev);
      }
    } else if (key.startsWith("$")) {
      throw invalidCondition(`unknown operator ${key}`);
    } else {
      const prev = ctx.enter();
      try {
        child = buildFieldNode(ctx, key, condition[key]);
      } finally {
        ctx.leave(prev);
      }
    }

    rawCount++;
    if (child instanceof AllOfNode) {
      for (const sub of child.children) {
        children.push(sub);
      }
    } else {
      children.push(child);
    }
  }

  if (rawCount === 1) {
    if (children.length === 1) {
      return children[0];
    }
    sortByPriority(children);
    return new AllOfNode(children);
  }

  ctx.addNode();
  sortByPriority(children);
  return new AllOfNode(children);
}

function isElementOperator(key: string, value: unknown): boolean {
  if (key === "$eq") {
    return !Array.isArray(value);
  }
  return ELEMENT_OPERATORS.has(key);
}

function splitArrayCondition(ctx: CompileContext, condition: Condition): Condition {
  const parsed: Condition = {};
  const elem: Condition = {};

  for (const key of sortedOwnKeys(condition)) {
    const value = condition[key];
    const isIndex = parseIndexKey(key) !== undefined;
    const customOp = ctx.cfg.customOperators.get(key);
    const isBuiltin = ctx.builders.has(key);

    if (isIndex) {
      setOwnProp(parsed, key, value);
    } else if (key === "$elemMatch") {
      if (isPlainObject(value)) {
        for (const ek of sortedOwnKeys(value)) {
          setOwnProp(elem, ek, value[ek]);
        }
      } else {
        setOwnProp(parsed, key, value);
      }
    } else if (customOp) {
      if (customOp.matchElements) {
        setOwnProp(elem, key, value);
      } else {
        setOwnProp(parsed, key, value);
      }
    } else if (isBuiltin) {
      if (isElementOperator(key, value)) {
        setOwnProp(elem, key, value);
      } else {
        setOwnProp(parsed, key, value);
      }
    } else {
      setOwnProp(elem, key, value);
    }
  }

  if (Object.keys(elem).length > 0) {
    setOwnProp(parsed, "$elemMatch", elem);
  }
  return parsed;
}

function buildArrayRecord(condition: unknown, existingCtx: CompileContext | undefined): MatcherNode {
  const ctx = existingCtx ?? new CompileContext(new CompileConfig(), TREE_HOOKS, BUILTIN_BUILDERS, false);
  const children: MatcherNode[] = [];

  if (Array.isArray(condition)) {
    children.push(
      ctx.hasConverters() ? new EqConvNode(condition, ctx.cfg, false) : new EqNode(condition, false),
    );
  }

  let child: MatcherNode;
  if (isPlainObject(condition)) {
    child = buildHashCondition(ctx, splitArrayCondition(ctx, condition as Condition));
  } else if (condition instanceof RegExp) {
    child = buildElemMatchNode(ctx, { $regex: condition });
  } else {
    child = buildElemMatchNode(ctx, { $eq: condition });
  }

  children.push(child);
  if (children.length === 1) {
    return children[0];
  }
  sortByPriority(children);
  return new AnyOfNode(children);
}

const TREE_HOOKS: TreeBuilderHooks = {
  buildHashCondition,
  buildLiteral,
};

export function compileRoot(cfg: CompileConfig, doc: Condition): MatcherNode {
  const ctx = new CompileContext(cfg, TREE_HOOKS, BUILTIN_BUILDERS, true);
  return buildHashCondition(ctx, doc);
}
