/**
 * Sentinel representing a field that is absent from its parent container.
 * Used internally for strict `$exists` / `$eq: null` / `$ne: null` distinction
 * and accepted as a return value from `withFieldResolver` to hide a field.
 */
export const MISSING: unique symbol = Symbol("mongory.missing");

export type Missing = typeof MISSING;

/**
 * A Mongory query condition document.
 */
export type Condition = {
  [key: string]: unknown;
};

/**
 * Valid inputs accepted by `compile` and `match`.
 * `null` and `undefined` compile to an empty match-all condition `{}`.
 */
export type ConditionInput = Condition | null | undefined;

/**
 * Result returned by `Matcher.trace`.
 */
export interface TraceResult {
  matched: boolean;
  trace: string;
}

/**
 * Constructor type helper for `withConverter`, `withField`, and `withFieldResolver`.
 */
export type Constructor<T extends object = object> = abstract new (...args: never[]) => T;

/**
 * Predicate guard matching a specific runtime type `T`.
 */
export type TypeGuard<T> = (value: unknown) => value is T;

/**
 * Custom operator evaluation predicate.
 *
 * When `exists` is `false`, the field is missing from its parent container and
 * `value` is `undefined`. When `exists` is `true`, `value` preserves the raw
 * record value.
 */
export type Predicate = (value: unknown, exists: boolean) => boolean;

/**
 * Compile-scoped custom operator definition registered via `withOperator`.
 */
export interface CustomOperator {
  /**
   * Validates and compiles the raw operator argument once at `compile` time,
   * returning a pure match predicate.
   */
  compile: (arg: unknown) => Predicate;
  /**
   * When `true`, implicit array matching applies this operator element-by-element
   * (like `$gt`) instead of passing the whole array (like `$size`).
   */
  matchElements?: boolean;
  /**
   * Sibling evaluation priority weight inside conjunctions (`<= 0` defaults to `3`).
   */
  priority?: number;
}

export const DEFAULT_MAX_DEPTH = 64;
export const DEFAULT_MAX_NODES = 4096;

/**
 * Returns true for plain JS objects (`{}` or `Object.create(null)`).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns true for plain objects or general data class instances that support
 * own-property field lookups (excluding scalar/collection built-ins such as
 * `Array`, `Date`, `RegExp`, typed arrays, `Map`, and `Set`).
 */
export function isRecordObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    return true;
  }
  if (
    Array.isArray(value) ||
    value instanceof Date ||
    value instanceof RegExp ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return false;
  }
  return true;
}

/**
 * Assigns an own data property without mutating `Object.prototype` when `key === "__proto__"`.
 */
export function setOwnProp(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    obj[key] = value;
  }
}

/**
 * Returns own enumerable keys sorted deterministically by code unit order.
 */
export function sortedOwnKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

/**
 * Canonical base-10 integer index parser ("0", "1", "-1").
 * Rejects non-canonical spellings such as "01", "-0", "+1", and "0\nfoo".
 */
export function parseIndexKey(key: string): number | undefined {
  if (!/^(?:0|-?[1-9]\d*)$/.test(key)) {
    return undefined;
  }
  const n = Number(key);
  return Number.isSafeInteger(n) ? n : undefined;
}
