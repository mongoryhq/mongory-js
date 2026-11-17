import { MISSING, isRecordObject, sortedOwnKeys } from "./types.js";

export interface MatcherNode {
  match(record: unknown): boolean;
  priority(): number;
  explain(lines: string[], prefix: string, isLast: boolean, isRoot: boolean): void;
  trace(record: unknown, lines: string[], prefix: string, isLast: boolean, isRoot: boolean): boolean;
}

export function childPrefixFor(prefix: string, isLast: boolean, isRoot: boolean): string {
  if (isRoot) {
    return "";
  }
  return isLast ? `${prefix}    ` : `${prefix}│   `;
}

export function writeTreeLine(
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  line: string,
): string {
  if (isRoot) {
    lines.push(line);
    return "";
  }
  lines.push(`${prefix}${isLast ? "└── " : "├── "}${line}`);
  return childPrefixFor(prefix, isLast, false);
}

export function statusLabel(matched: boolean): "PASS" | "FAIL" {
  return matched ? "PASS" : "FAIL";
}

export function traceLeaf(
  node: MatcherNode,
  record: unknown,
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  label: string,
): boolean {
  const matched = node.match(record);
  writeTreeLine(lines, prefix, isLast, isRoot, `[${statusLabel(matched)}] ${label} | value=${formatTraceValue(record)}`);
  return matched;
}

export function explainBranch(
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  label: string,
  children: ReadonlyArray<MatcherNode>,
): void {
  const childPrefix = writeTreeLine(lines, prefix, isLast, isRoot, label);
  for (let i = 0; i < children.length; i++) {
    children[i].explain(lines, childPrefix, i === children.length - 1, false);
  }
}

export function traceGroup(
  record: unknown,
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  op: "And" | "Or",
  children: ReadonlyArray<MatcherNode>,
  stopOn: boolean,
): boolean {
  if (children.length === 0) {
    const matched = !stopOn;
    writeTreeLine(
      lines,
      prefix,
      isLast,
      isRoot,
      `[${statusLabel(matched)}] ${op} (empty) | value=${formatTraceValue(record)}`,
    );
    return matched;
  }
  const childPrefix = childPrefixFor(prefix, isLast, isRoot);
  const childLines: string[] = [];
  let matched = !stopOn;
  for (let i = 0; i < children.length; i++) {
    const res = children[i].trace(record, childLines, childPrefix, i === children.length - 1, false);
    if (res === stopOn) {
      matched = stopOn;
      const rem = children.length - i - 1;
      if (rem > 0) {
        writeTreeLine(childLines, childPrefix, true, false, `[SKIP] ${rem} remaining branch(es) (short-circuited)`);
      }
      break;
    }
  }
  writeTreeLine(lines, prefix, isLast, isRoot, `[${statusLabel(matched)}] ${op} | value=${formatTraceValue(record)}`);
  for (const line of childLines) {
    lines.push(line);
  }
  return matched;
}

export function traceWrapped(
  record: unknown,
  lines: string[],
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  label: string,
  inner: MatcherNode,
  invert: boolean,
): boolean {
  const childPrefix = childPrefixFor(prefix, isLast, isRoot);
  const childLines: string[] = [];
  let matched = inner.trace(record, childLines, childPrefix, true, false);
  if (invert) {
    matched = !matched;
  }
  writeTreeLine(lines, prefix, isLast, isRoot, `[${statusLabel(matched)}] ${label} | value=${formatTraceValue(record)}`);
  for (const line of childLines) {
    lines.push(line);
  }
  return matched;
}

const MAX_STR_LEN = 64;
const MAX_ARR_ELEMS = 8;
const MAX_OBJ_KEYS = 8;
const MAX_FORMAT_DEPTH = 4;

function truncateString(s: string): string {
  if (s.length <= MAX_STR_LEN) {
    return JSON.stringify(s);
  }
  return `${JSON.stringify(s.slice(0, MAX_STR_LEN))}...`;
}

export function formatTraceValue(value: unknown, seen?: Set<object>, depth = 0): string {
  if (value === MISSING) {
    return "<missing>";
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (typeof value === "number") {
    if (Object.is(value, -0)) {
      return "-0";
    }
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "boolean" || typeof value === "symbol") {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function${value.name ? `: ${value.name}` : ""}]`;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Date(Invalid)" : value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.byteLength})`;
  }
  if (typeof value !== "object") {
    return String(value);
  }

  const visited = seen ?? new Set<object>();
  if (visited.has(value)) {
    return "<cycle>";
  }
  if (depth >= MAX_FORMAT_DEPTH) {
    return Array.isArray(value) ? `[...${value.length} items]` : "{...}";
  }

  visited.add(value);
  try {
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_ARR_ELEMS);
      const parts: string[] = [];
      for (let i = 0; i < limit; i++) {
        parts.push(formatTraceValue(value[i], visited, depth + 1));
      }
      if (value.length > limit) {
        parts.push(`...(+${value.length - limit})`);
      }
      return `[${parts.join(", ")}]`;
    }
    if (!isRecordObject(value)) {
      return Object.prototype.toString.call(value);
    }
    const keys = sortedOwnKeys(value);
    const limit = Math.min(keys.length, MAX_OBJ_KEYS);
    const parts: string[] = [];
    for (let i = 0; i < limit; i++) {
      const k = keys[i];
      parts.push(`${JSON.stringify(k)}: ${formatTraceValue(value[k], visited, depth + 1)}`);
    }
    if (keys.length > limit) {
      parts.push(`...(+${keys.length - limit})`);
    }
    return `{${parts.join(", ")}}`;
  } finally {
    visited.delete(value);
  }
}

export function formatValue(value: unknown): string {
  return formatTraceValue(value);
}
