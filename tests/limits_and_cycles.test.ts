import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MongoryInvalidConditionError,
  MongoryInvalidOptionError,
  MongoryLimitExceededError,
  compileMatcher as compile,
  withMaxDepth,
  withMaxNodes,
} from "../src/index.js";

test("maxDepth limit and ErrLimitExceeded hierarchy", () => {
  assert.equal(DEFAULT_MAX_DEPTH, 64);
  assert.equal(DEFAULT_MAX_NODES, 4096);

  const deep: Record<string, unknown> = {};
  let cur = deep;
  for (let i = 0; i < 65; i++) {
    const next: Record<string, unknown> = {};
    cur[`k${i}`] = next;
    cur = next;
  }
  cur.leaf = 1;

  assert.throws(() => compile(deep), (err: unknown) => {
    assert.ok(err instanceof MongoryLimitExceededError);
    assert.ok(err instanceof MongoryInvalidConditionError);
    return true;
  });

  // Explicit override allows deeper trees or disables limit when <= 0
  const okDeep = compile(deep, withMaxDepth(128));
  assert.equal(okDeep.match({}), false);
  const unlimited = compile(deep, withMaxDepth(0));
  assert.equal(unlimited.match({}), false);

  // Small maxDepth rejects shallow nesting
  assert.throws(() => compile({ "a.b.c.d": 1 }, withMaxDepth(3)), MongoryLimitExceededError);
});

test("maxNodes limit counts single large $in as 1 node", () => {
  const manyItems = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
  const m = compile({ tag: { $in: manyItems } }, withMaxNodes(5));
  assert.equal(m.match({ tag: "item-999" }), true);
  assert.equal(m.match({ tag: "missing" }), false);

  const flatWide: Record<string, unknown> = {};
  for (let i = 0; i < 10; i++) {
    flatWide[`f${i}`] = i;
  }
  assert.throws(() => compile(flatWide, withMaxNodes(5)), MongoryLimitExceededError);

  const manyEmptyOr = { $or: Array.from({ length: 10 }, () => ({})) };
  assert.throws(() => compile(manyEmptyOr, withMaxNodes(5)), MongoryLimitExceededError);
});

test("invalid limit option throws MongoryInvalidOptionError", () => {
  for (const bad of [NaN, 1.5, Infinity]) {
    assert.throws(() => compile({}, withMaxDepth(bad)), (err: unknown) => {
      assert.ok(err instanceof MongoryInvalidOptionError);
      assert.equal(err instanceof MongoryInvalidConditionError, false);
      return true;
    });
    assert.throws(() => compile({}, withMaxNodes(bad)), MongoryInvalidOptionError);
  }
});

test("large $in / $nin Set lookup accuracy with mixed types, NaN, -0, bigint, Date, fallback", () => {
  const t = new Date("2026-05-01T00:00:00Z");
  const big = 9007199254740995n;
  const items: unknown[] = [
    null,
    true,
    false,
    -0,
    NaN,
    big,
    t,
    { nested: { a: 1 } },
    [1, 2],
    ...Array.from({ length: 25 }, (_, i) => `k-${i}`),
  ];

  const mIn = compile({ v: { $in: items } });
  const mNin = compile({ v: { $nin: items } });

  for (const hit of [
    null,
    true,
    false,
    0,
    -0,
    big,
    new Date(t.getTime()),
    { nested: { a: 1 } },
    [[1, 2]],
    "k-24",
    ["no", "k-3"],
  ]) {
    assert.equal(mIn.match({ v: hit }), true, `expected $in hit for ${String(hit)}`);
    assert.equal(mNin.match({ v: hit }), false, `expected $nin miss for ${String(hit)}`);
  }

  for (const miss of [NaN, 9007199254740994n, 1, "nope", { nested: { a: 2 } }, [1, 2], [2, 1]]) {
    assert.equal(mIn.match({ v: miss }), false, `expected $in miss for ${String(miss)}`);
    assert.equal(mNin.match({ v: miss }), true, `expected $nin hit for ${String(miss)}`);
  }
  assert.equal(mIn.match({}), false);
  assert.equal(mNin.match({}), true);
});

test("cyclic condition detection vs non-cyclic shared DAG refs", () => {
  const cyclicObj: Record<string, unknown> = {};
  cyclicObj.self = cyclicObj;
  assert.throws(() => compile(cyclicObj), MongoryInvalidConditionError);

  const cyclicArr: unknown[] = [];
  cyclicArr.push(cyclicArr);
  assert.throws(() => compile({ tags: { $in: cyclicArr } }), MongoryInvalidConditionError);

  // Shared DAG reference (diamond, not a cycle) must compile and work
  const shared = { status: "active" };
  const dag = compile({ $and: [shared, shared] });
  assert.equal(dag.match({ status: "active" }), true);
});

test("cyclic records do not stack-overflow valuesEqual or trace", () => {
  const recA: Record<string, unknown> = { id: 1 };
  recA.self = recA;
  const recB: Record<string, unknown> = { id: 1 };
  recB.self = recB;

  const condRec: Record<string, unknown> = { id: 1 };
  const m = compile({ id: 1, "self.id": 1 });
  assert.equal(m.match(recA), true);
  assert.equal(m.trace(recA).matched, true);
  assert.ok(m.trace(recA).trace.includes("[PASS]"));

  const mEq = compile({ doc: { $eq: condRec } });
  assert.equal(mEq.match({ doc: { id: 1 } }), true);
  assert.equal(mEq.match({ doc: recB }), false);
  assert.ok(mEq.trace({ doc: recB }).trace.includes("<cycle>"));
});
