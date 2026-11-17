/**
 * Base error thrown for all Mongory compilation or option errors.
 */
export class MongoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by `compile` and `match` when a query condition is malformed,
 * contains an unknown `$` operator, or violates operator argument rules.
 */
export class MongoryInvalidConditionError extends MongoryError {}

/**
 * Thrown when a condition exceeds the configured `maxDepth` or `maxNodes`
 * compile-time limit. Extends {@link MongoryInvalidConditionError}.
 */
export class MongoryLimitExceededError extends MongoryInvalidConditionError {}

/**
 * Thrown by `compile` and `match` when a compile option (`withOperator`,
 * `withConverter`, `withField`, etc.) is misconfigured. Separate from
 * {@link MongoryInvalidConditionError} so callers can distinguish setup bugs
 * from untrusted query inputs.
 */
export class MongoryInvalidOptionError extends MongoryError {}
