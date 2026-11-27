import assert from "node:assert/strict";
import test from "node:test";
import { mongory } from "../src/index.js";
import defaultOp, { op } from "../src/op.js";

test("op exports frozen string constants for all built-in operators", () => {
  assert.equal(defaultOp, op);
  assert.equal(Object.isFrozen(op), true);

  const expected = {
    eq: "$eq",
    ne: "$ne",
    gt: "$gt",
    gte: "$gte",
    lt: "$lt",
    lte: "$lte",
    in: "$in",
    nin: "$nin",
    exists: "$exists",
    present: "$present",
    and: "$and",
    or: "$or",
    nor: "$nor",
    not: "$not",
    elemMatch: "$elemMatch",
    every: "$every",
    size: "$size",
    regex: "$regex",
    options: "$options",
  };

  assert.deepEqual(op, expected);
});

test("op constants compile and match end-to-end", () => {
  const matcher = mongory.compile({
    [op.and]: [
      { age: { [op.gte]: 18, [op.lt]: 65, [op.gt]: 17, [op.lte]: 64, [op.ne]: 20 } },
      { role: { [op.in]: ["admin", "editor"], [op.nin]: ["guest"] } },
      { nickname: { [op.exists]: false } },
      { name: { [op.present]: true, [op.regex]: "^alice$", [op.options]: "i" } },
      { status: { [op.not]: { [op.eq]: "banned" } } },
      { scores: { [op.size]: 2, [op.every]: { [op.gte]: 80 }, [op.elemMatch]: { [op.gt]: 90 } } },
      {
        [op.or]: [
          { active: true },
          { vip: true },
        ],
      },
    ],
  });

  assert.equal(
    matcher.match({
      age: 30,
      role: "admin",
      name: "Alice",
      status: "active",
      scores: [85, 95],
      active: true,
    }),
    true,
  );

  assert.equal(
    matcher.match({
      age: 30,
      role: "admin",
      name: "Alice",
      status: "banned",
      scores: [85, 95],
      active: true,
    }),
    false,
  );
});
