import { mergeExpandedNode } from "./combinators.js";
import { MongoryInvalidConditionError, MongoryLimitExceededError } from "./errors.js";
import { CompileConfig } from "./options.js";
import { Condition, isPlainObject, setOwnProp, sortedOwnKeys } from "./types.js";

/**
 * Splits a condition key on unescaped dots (`.`) and unescapes `\.` to `.`.
 */
export function splitKey(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === "\\" && i + 1 < key.length && key[i + 1] === ".") {
      current += ".";
      i++;
    } else if (ch === ".") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Expands `["a", "b"]` and `value` into `{ a: { b: value } }`.
 */
function expandParts(parts: string[], value: unknown): Condition {
  let result: Condition = {};
  setOwnProp(result, parts[parts.length - 1], value);
  for (let i = parts.length - 2; i >= 0; i--) {
    const wrapped: Condition = {};
    setOwnProp(wrapped, parts[i], result);
    result = wrapped;
  }
  return result;
}

export function checkDepthLimit(depth: number, maxDepth: number): void {
  if (maxDepth > 0 && depth > maxDepth) {
    throw new MongoryLimitExceededError(`condition depth ${depth} exceeds max depth ${maxDepth}`);
  }
}

export function cloneStatelessRegExp(re: RegExp): RegExp {
  const flags = re.flags.replace(/[gy]/g, "");
  return new RegExp(re.source, flags);
}

/**
 * Normalizes a top-level condition document:
 * - `null` / `undefined` -> `{}`
 * - Non-document -> throws `MongoryInvalidConditionError`
 * - Rejects circular object/array references
 * - Expands dotted keys while converting leaf collisions into `$and`
 * - Applies registered converters to non-custom-op values once
 * - Enforces `maxDepth`
 */
export function convertRootCondition(condition: unknown, cfg: CompileConfig): Condition {
  if (condition === null || condition === undefined) {
    return {};
  }
  const seen = new Set<object>();
  let target: unknown = condition;
  if (cfg.hasConverters()) {
    target = cfg.applyConverter(condition);
    if (target === null || target === undefined) {
      return {};
    }
  }
  if (!isPlainObject(target)) {
    throw new MongoryInvalidConditionError(
      `condition must be a plain object, got ${describeType(condition)}`,
    );
  }
  if (Object.keys(target).length === 0) {
    return {};
  }
  return normalizeConditionObject(target, 0, cfg, cfg.hasConverters(), seen);
}

function normalizeConditionObject(
  obj: Record<string, unknown>,
  depth: number,
  cfg: CompileConfig,
  applyConv: boolean,
  seen: Set<object>,
): Condition {
  if (seen.has(obj)) {
    throw new MongoryInvalidConditionError("condition contains a cyclic reference");
  }
  seen.add(obj);
  try {
    const out: Condition = {};
    const conflicts: Condition[] = [];

    for (const key of sortedOwnKeys(obj)) {
      const parts = splitKey(key);
      const nextDepth = depth + parts.length;
      checkDepthLimit(nextDepth, cfg.maxDepth);

      const lastKey = parts[parts.length - 1];
      const rawVal = obj[key];
      let val: unknown;
      if (cfg.customOperators.has(lastKey)) {
        // Custom operators receive raw caller arguments intact (B1 invariant).
        val = rawVal;
      } else {
        val = normalizeValue(rawVal, nextDepth, cfg, applyConv, seen);
      }

      const residual = mergeExpandedNode(out, expandParts(parts, val));
      if (residual) {
        conflicts.push(residual);
      }
    }

    if (conflicts.length > 0) {
      if (Object.hasOwn(out, "$and") && Array.isArray(out.$and)) {
        out.$and = [...out.$and, ...conflicts];
      } else {
        setOwnProp(out, "$and", conflicts);
      }
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function normalizeValue(
  value: unknown,
  depth: number,
  cfg: CompileConfig,
  applyConv: boolean,
  seen: Set<object>,
): unknown {
  if (applyConv && value !== null && value !== undefined) {
    const converted = cfg.applyConverter(value);
    if (converted !== value) {
      // Apply converter at most once to avoid chained converter cycles (B1).
      return normalizeValue(converted, depth, cfg, false, seen);
    }
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof RegExp) {
    return cloneStatelessRegExp(value);
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new MongoryInvalidConditionError("condition contains a cyclic reference");
    }
    seen.add(value);
    try {
      const out: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const elem = value[i];
        let elemDepth = depth;
        if (isNestedContainer(elem)) {
          elemDepth = depth + 1;
          checkDepthLimit(elemDepth, cfg.maxDepth);
        }
        out[i] = normalizeValue(elem, elemDepth, cfg, applyConv, seen);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }
  if (isPlainObject(value)) {
    return normalizeConditionObject(value, depth, cfg, applyConv, seen);
  }
  return value;
}

function isNestedContainer(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Array.isArray(value) || isPlainObject(value);
}

export function describeType(v: unknown): string {
  if (v === null) {
    return "null";
  }
  if (v === undefined) {
    return "undefined";
  }
  if (Array.isArray(v)) {
    return "array";
  }
  if (v instanceof RegExp) {
    return "RegExp";
  }
  if (v instanceof Date) {
    return "Date";
  }
  return typeof v;
}
