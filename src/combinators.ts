import { valuesEqual } from "./compare.js";
import { Condition, isPlainObject, setOwnProp, sortedOwnKeys } from "./types.js";

function clonePlainObject(src: Record<string, unknown>): Condition {
  const out: Condition = {};
  for (const k of sortedOwnKeys(src)) {
    setOwnProp(out, k, src[k]);
  }
  return out;
}

function isPureOpMap(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return false;
  }
  for (const k of keys) {
    if (!k.startsWith("$") || k === "$regex" || k === "$options") {
      return false;
    }
  }
  return true;
}

function mapsCompatible(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k of Object.keys(b)) {
    if (Object.hasOwn(a, k) && !valuesEqual(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

function mergeNewMaps(a: Record<string, unknown>, b: Record<string, unknown>): Condition {
  const out = clonePlainObject(a);
  for (const k of sortedOwnKeys(b)) {
    setOwnProp(out, k, b[k]);
  }
  return out;
}

function appendUniqueDoc(list: Condition[], doc: Condition): void {
  for (const existing of list) {
    if (valuesEqual(existing, doc)) {
      return;
    }
  }
  list.push(doc);
}

function appendFlattenedAnd(out: Condition[], c: Condition | null | undefined): void {
  if (!isPlainObject(c)) {
    return;
  }
  const keys = sortedOwnKeys(c);
  if (keys.length === 0) {
    return;
  }
  const hasAnd = Object.hasOwn(c, "$and");
  if (!hasAnd || !Array.isArray(c.$and) || !c.$and.every((item) => item === null || item === undefined || isPlainObject(item))) {
    out.push(c);
    return;
  }
  if (keys.length > 1) {
    const rest: Condition = {};
    for (const k of keys) {
      if (k !== "$and") {
        setOwnProp(rest, k, c[k]);
      }
    }
    out.push(rest);
  }
  for (const sub of c.$and) {
    appendFlattenedAnd(out, sub as Condition | null | undefined);
  }
}

function appendFlattenedOr(out: Condition[], c: Condition | null | undefined): boolean {
  if (c === null || c === undefined || !isPlainObject(c)) {
    return false;
  }
  const keys = sortedOwnKeys(c);
  if (keys.length === 0) {
    return true;
  }
  if (
    keys.length === 1 &&
    keys[0] === "$or" &&
    Array.isArray(c.$or) &&
    c.$or.every((item) => item === null || item === undefined || isPlainObject(item))
  ) {
    for (const sub of c.$or) {
      if (appendFlattenedOr(out, sub as Condition | null | undefined)) {
        return true;
      }
    }
    return false;
  }
  appendUniqueDoc(out, clonePlainObject(c));
  return false;
}

/**
 * Combines multiple query conditions with conjunction semantics without mutating
 * caller objects:
 * - `null`, `undefined`, and `{}` act as identity elements and are omitted.
 * - Nested `$and` arrays are flattened.
 * - Disjoint keys and compatible pure-`$` operator subdocuments (`$gte` + `$lte`,
 *   excluding coupled `$regex`/`$options`) are merged.
 * - Identical clauses are deduplicated; conflicting keys remain inside `$and`.
 */
export function and(...conditions: Array<Condition | null | undefined>): Condition {
  const flat: Condition[] = [];
  for (const c of conditions) {
    appendFlattenedAnd(flat, c);
  }
  const merged: Condition = {};
  const conflicts: Condition[] = [];

  for (const clause of flat) {
    for (const k of sortedOwnKeys(clause)) {
      const sv = clause[k];
      if (!Object.hasOwn(merged, k)) {
        setOwnProp(merged, k, sv);
        continue;
      }
      const dv = merged[k];
      if (valuesEqual(dv, sv)) {
        continue;
      }
      if (isPureOpMap(dv) && isPureOpMap(sv) && mapsCompatible(dv, sv)) {
        setOwnProp(merged, k, mergeNewMaps(dv, sv));
        continue;
      }
      const conflict: Condition = {};
      setOwnProp(conflict, k, sv);
      appendUniqueDoc(conflicts, conflict);
    }
  }

  if (conflicts.length === 0) {
    return merged;
  }
  if (Object.keys(merged).length === 0 && conflicts.length === 1) {
    return clonePlainObject(conflicts[0]);
  }
  setOwnProp(merged, "$and", conflicts);
  return merged;
}

/**
 * Combines multiple query conditions with disjunction semantics without mutating
 * caller objects:
 * - `null` and `undefined` are skipped as omitted branches.
 * - An explicit empty object `{}` represents match-all and absorbs the disjunction to `{}`.
 * - Nested `$or` arrays are flattened and branches deduplicated.
 * - When no non-null branches remain, returns `{ $or: [] }` (fail-closed, matches nothing).
 */
export function or(...conditions: Array<Condition | null | undefined>): Condition {
  const branches: Condition[] = [];
  for (const c of conditions) {
    if (appendFlattenedOr(branches, c)) {
      return {};
    }
  }
  if (branches.length === 0) {
    return { $or: [] };
  }
  if (branches.length === 1) {
    return branches[0];
  }
  return { $or: branches };
}

/**
 * Merges a single dotted-path expansion object `src` into `dst`.
 * Disjoint sub-objects merge recursively; leaf collisions return the residual
 * branch so the caller appends it to `$and` instead of silently overwriting.
 */
export function mergeExpandedNode(dst: Condition, src: Condition): Condition | undefined {
  let residual: Condition | undefined;
  for (const k of sortedOwnKeys(src)) {
    const sv = src[k];
    if (!Object.hasOwn(dst, k)) {
      setOwnProp(dst, k, sv);
      continue;
    }
    const dv = dst[k];
    if (valuesEqual(dv, sv)) {
      continue;
    }
    if (isPlainObject(dv) && isPlainObject(sv)) {
      const subResidual = mergeExpandedNode(dv, sv);
      if (subResidual) {
        residual ??= {};
        setOwnProp(residual, k, subResidual);
      }
      continue;
    }
    residual ??= {};
    setOwnProp(residual, k, sv);
  }
  return residual;
}
