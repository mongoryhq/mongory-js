import { MongoryInvalidConditionError, MongoryLimitExceededError } from "./errors.js";
import { MatcherNode } from "./explain.js";
import { CompileConfig } from "./options.js";
import { Condition } from "./types.js";

export type OperatorBuilder = (ctx: CompileContext, condition: unknown) => MatcherNode;

export interface TreeBuilderHooks {
  buildHashCondition(ctx: CompileContext, condition: Condition): MatcherNode;
  buildLiteral(ctx: CompileContext, condition: unknown): MatcherNode;
}

export class CompileContext {
  readonly cfg: CompileConfig;
  readonly hooks: TreeBuilderHooks;
  readonly builders: ReadonlyMap<string, OperatorBuilder>;
  readonly enforceLimits: boolean;
  depth = 0;
  nodes = 0;

  constructor(
    cfg: CompileConfig,
    hooks: TreeBuilderHooks,
    builders: ReadonlyMap<string, OperatorBuilder>,
    enforceLimits = true,
  ) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.builders = builders;
    this.enforceLimits = enforceLimits;
  }

  withoutLimits(): CompileContext | undefined {
    if (!this.cfg.hasExtensions()) {
      return undefined;
    }
    return new CompileContext(this.cfg, this.hooks, this.builders, false);
  }

  hasConverters(): boolean {
    return this.cfg.hasConverters();
  }

  addNode(): void {
    if (!this.enforceLimits || this.cfg.maxNodes <= 0) {
      return;
    }
    if (this.nodes >= this.cfg.maxNodes) {
      throw new MongoryLimitExceededError(
        `matcher node count exceeds max nodes ${this.cfg.maxNodes}`,
      );
    }
    this.nodes++;
  }

  addNodeMatcher<T extends MatcherNode>(node: T): T {
    this.addNode();
    return node;
  }

  enter(): number {
    const prev = this.depth;
    this.depth++;
    if (this.enforceLimits && this.cfg.maxDepth > 0 && this.depth > this.cfg.maxDepth) {
      throw new MongoryLimitExceededError(
        `condition depth ${this.depth} exceeds max depth ${this.cfg.maxDepth}`,
      );
    }
    return prev;
  }

  leave(prev: number): void {
    this.depth = prev;
  }
}

export function sortByPriority(nodes: MatcherNode[]): void {
  nodes.sort((a, b) => a.priority() - b.priority());
}

export function invalidCondition(message: string): MongoryInvalidConditionError {
  return new MongoryInvalidConditionError(`mongory: invalid condition: ${message}`);
}
