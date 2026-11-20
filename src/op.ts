/**
 * Built-in Mongory query operator key constants.
 *
 * Using these constants avoids typos in condition keys with zero runtime
 * overhead:
 *
 * ```ts
 * import { mongory } from "mongory-js";
 * import { op } from "mongory-js/op";
 *
 * const matcher = mongory.compile({
 *   age: { [op.gte]: 18, [op.lt]: 65 },
 *   [op.or]: [
 *     { role: { [op.in]: ["admin", "editor"] } },
 *     { name: { [op.regex]: "^a", [op.options]: "i" } },
 *   ],
 * });
 * ```
 */
export const op = Object.freeze({
  // Comparison operators
  eq: "$eq",
  ne: "$ne",
  gt: "$gt",
  gte: "$gte",
  lt: "$lt",
  lte: "$lte",

  // Inclusion operators
  in: "$in",
  nin: "$nin",

  // Existence operators
  exists: "$exists",
  present: "$present",

  // Logical operators
  and: "$and",
  or: "$or",
  not: "$not",

  // Array operators
  elemMatch: "$elemMatch",
  every: "$every",
  size: "$size",

  // Regex operator and its modifier key
  regex: "$regex",
  options: "$options",
} as const);

export type OperatorKey = (typeof op)[keyof typeof op];

export default op;
