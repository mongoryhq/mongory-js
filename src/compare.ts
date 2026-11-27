import { MISSING, isRecordObject, sortedOwnKeys } from "./types.js";

/**
 * Compares two numeric values (`number` or `bigint`) without losing integer
 * precision near `2^53`. Returns `undefined` if either is `NaN`.
 */
export function compareNumbers(a: number | bigint, b: number | bigint): number | undefined {
  if (typeof a === "number") {
    if (Number.isNaN(a)) {
      return undefined;
    }
    if (typeof b === "number") {
      if (Number.isNaN(b)) {
        return undefined;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    }
    const cmp = compareBigIntFloat(b, a);
    return cmp === 0 ? 0 : -cmp;
  }
  if (typeof b === "bigint") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (Number.isNaN(b)) {
    return undefined;
  }
  return compareBigIntFloat(a, b);
}

function compareBigIntFloat(i: bigint, f: number): number {
  if (!Number.isFinite(f)) {
    return f > 0 ? -1 : 1;
  }
  const trunc = Math.trunc(f);
  const biTrunc = BigInt(trunc);
  if (i < biTrunc) {
    return -1;
  }
  if (i > biTrunc) {
    return 1;
  }
  const frac = f - trunc;
  if (frac > 0) {
    return -1;
  }
  if (frac < 0) {
    return 1;
  }
  return 0;
}

function isNumeric(v: unknown): v is number | bigint {
  return typeof v === "number" || typeof v === "bigint";
}

/**
 * Orders comparable scalar pairs (`number | bigint`, `string`, `Date`).
 * Returns `undefined` when incompatible, `NaN`, invalid `Date`, or `MISSING`.
 */
export function compareValues(a: unknown, b: unknown): number | undefined {
  if (a === MISSING || b === MISSING) {
    return undefined;
  }
  if (isNumeric(a) && isNumeric(b)) {
    return compareNumbers(a, b);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (a instanceof Date && b instanceof Date) {
    const ta = a.getTime();
    const tb = b.getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) {
      return undefined;
    }
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  return undefined;
}

type SeenPairs = WeakMap<object, WeakSet<object>>;

function hasSeenPair(seen: SeenPairs, a: object, b: object): boolean {
  return seen.get(a)?.has(b) === true;
}

function addSeenPair(seen: SeenPairs, a: object, b: object): void {
  let set = seen.get(a);
  if (!set) {
    set = new WeakSet<object>();
    seen.set(a, set);
  }
  set.add(b);
}

function deleteSeenPair(seen: SeenPairs, a: object, b: object): void {
  seen.get(a)?.delete(b);
}

/**
 * Deep structural equality matching `mongory-spec` semantics:
 * - `MISSING` equals nothing
 * - `NaN` equals nothing (even itself)
 * - `number` and `bigint` compare mathematically (`-0 === 0`, exact near `2^53`)
 * - Objects ignore key order and treat `undefined` properties as absent
 * - Arrays are order-sensitive
 */
export function valuesEqual(a: unknown, b: unknown, seen?: SeenPairs): boolean {
  if (a === MISSING || b === MISSING || a === undefined || b === undefined) {
    return false;
  }
  if (a === null || b === null) {
    return a === null && b === null;
  }
  if (isNumeric(a) && isNumeric(b)) {
    return compareNumbers(a, b) === 0;
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date && b instanceof Date)) {
      return false;
    }
    const ta = a.getTime();
    const tb = b.getTime();
    return !Number.isNaN(ta) && ta === tb;
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.byteLength !== b.byteLength) {
      return false;
    }
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  const pairMap = seen ?? new WeakMap<object, WeakSet<object>>();
  if (hasSeenPair(pairMap, a, b)) {
    return true;
  }
  addSeenPair(pairMap, a, b);
  try {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!valuesEqual(a[i], b[i], pairMap)) {
          return false;
        }
      }
      return true;
    }
    if (!isRecordObject(a) || !isRecordObject(b)) {
      return a === b;
    }
    const keysA = definedKeys(a);
    const keysB = definedKeys(b);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (let i = 0; i < keysA.length; i++) {
      const k = keysA[i];
      if (keysB[i] !== k || !valuesEqual(a[k], b[k], pairMap)) {
        return false;
      }
    }
    return true;
  } finally {
    deleteSeenPair(pairMap, a, b);
  }
}

function definedKeys(obj: Record<string, unknown>): string[] {
  const raw = sortedOwnKeys(obj);
  const out: string[] = [];
  for (const k of raw) {
    if (obj[k] !== undefined) {
      out.push(k);
    }
  }
  return out;
}

/**
 * Presence semantics: false for `MISSING`, `undefined`, `null`, `false`, `""`,
 * `[]`, `{}` (with no defined keys); true for everything else (including `0`).
 */
export function isPresent(v: unknown): boolean {
  if (v === MISSING || v === undefined || v === null) {
    return false;
  }
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "string") {
    return v.length > 0;
  }
  if (Array.isArray(v)) {
    return v.length > 0;
  }
  if (v instanceof Uint8Array) {
    return v.byteLength > 0;
  }
  if (typeof v === "object") {
    if (!isRecordObject(v)) {
      return true;
    }
    for (const k of Object.keys(v)) {
      if (v[k] !== undefined) {
        return true;
      }
    }
    return false;
  }
  return true;
}
