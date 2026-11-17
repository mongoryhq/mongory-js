export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MISSING,
  type Condition,
  type ConditionInput,
  type Constructor,
  type CustomOperator,
  type Missing,
  type Predicate,
  type TraceResult,
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

export { and, or } from "./combinators.js";

export {
  Matcher,
  any,
  compile,
  count,
  filter,
  filterLimit,
  find,
  match,
} from "./matcher.js";
