import { and as mongoryAnd, or as mongoryOr } from "./combinators.js";
import { Matcher, compileMatcher, matchCondition } from "./matcher.js";
import {
  withConverter,
  withField,
  withFieldResolver,
  withMaxDepth,
  withMaxNodes,
  withOperator,
  withOptions,
} from "./options.js";
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_NODES, MISSING } from "./types.js";

export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MISSING,
  type Condition,
  type ConditionInput,
  type Constructor,
  type CustomOperator,
  type ExplainNode,
  type MatcherNodeKind,
  type Missing,
  type Predicate,
  type TraceNode,
  type TraceResult,
  type TraceStatus,
  type TraceTreeResult,
  type TypeGuard,
} from "./types.js";

export {
  MongoryError,
  MongoryInvalidConditionError,
  MongoryInvalidOptionError,
  MongoryLimitExceededError,
} from "./errors.js";

export {
  withConverter,
  withField,
  withFieldResolver,
  withMaxDepth,
  withMaxNodes,
  withOperator,
  withOptions,
  type CompileOption,
} from "./options.js";

export { mongoryAnd, mongoryOr };
export { Matcher, compileMatcher, matchCondition };

/**
 * Namespace entrypoint for collision-free idiomatic usage (`import { mongory } from "mongory-js"`).
 */
export const mongory = {
  compile: compileMatcher,
  match: matchCondition,
  and: mongoryAnd,
  or: mongoryOr,
  filter: <T>(records: Iterable<T>, matcher: Matcher): T[] => matcher.filter(records),
  filterLimit: <T>(records: Iterable<T>, matcher: Matcher, limit: number): T[] =>
    matcher.filterLimit(records, limit),
  find: <T>(records: Iterable<T>, matcher: Matcher): T | undefined => matcher.find(records),
  any: (records: Iterable<unknown>, matcher: Matcher): boolean => matcher.any(records),
  count: (records: Iterable<unknown>, matcher: Matcher): number => matcher.count(records),
  withOptions,
  withMaxDepth,
  withMaxNodes,
  withConverter,
  withField,
  withFieldResolver,
  withOperator,
  Matcher,
  MISSING,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
} as const;

export default mongory;
