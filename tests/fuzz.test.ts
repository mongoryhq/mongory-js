import assert from "node:assert/strict";
import test from "node:test";
import { MongoryError, mongory } from "../src/index.js";

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: ReadonlyArray<T>): T {
  return items[Math.floor(rng() * items.length)]!;
}

const FIELD_KEYS = [
  "a",
  "b",
  "age",
  "status",
  "tags",
  "profile.city",
  "0",
  "-1",
  "01",
  "-0",
  "a\\.b",
  "__proto__",
  "constructor",
];

const OP_KEYS = [
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$and",
  "$or",
  "$not",
  "$elemMatch",
  "$every",
  "$size",
  "$exists",
  "$present",
  "$regex",
  "$options",
  "$unknown",
];

const SCALARS: ReadonlyArray<unknown> = [
  null,
  undefined,
  true,
  false,
  0,
  -0,
  1,
  -1,
  18,
  40,
  3.14,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0n,
  18n,
  -1n,
  "",
  "active",
  "inactive",
  "go",
  "ruby",
  "^a[0-9]+$",
  "[invalid",
  new Date("2025-01-01T00:00:00Z"),
  new Uint8Array([1, 2, 3]),
];

function randomValue(rng: () => number, depth: number, allowOps: boolean): unknown {
  if (depth <= 0 || rng() < 0.55) {
    return pick(rng, SCALARS);
  }
  if (rng() < 0.45) {
    const len = Math.floor(rng() * 4);
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) {
      arr.push(randomValue(rng, depth - 1, allowOps));
    }
    return arr;
  }
  const obj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const len = Math.floor(rng() * 4);
  for (let i = 0; i < len; i++) {
    const key = allowOps && rng() < 0.55 ? pick(rng, OP_KEYS) : pick(rng, FIELD_KEYS);
    Object.defineProperty(obj, key, {
      value: randomValue(rng, depth - 1, allowOps),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return obj;
}

function randomRootCondition(rng: () => number, depth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const len = Math.floor(rng() * 4);
  for (let i = 0; i < len; i++) {
    const key = rng() < 0.4 ? pick(rng, OP_KEYS) : pick(rng, FIELD_KEYS);
    Object.defineProperty(obj, key, {
      value: randomValue(rng, depth - 1, true),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return obj;
}

function randomRecord(rng: () => number): unknown {
  if (rng() < 0.15) {
    return randomValue(rng, 2, false);
  }
  const rec: Record<string, unknown> = {
    a: randomValue(rng, 2, false),
    b: randomValue(rng, 2, false),
    age: pick(rng, [10, 18, 25, "18", null, [15, 25], undefined]),
    status: pick(rng, ["active", "inactive", null, ["active"]]),
    tags: pick(rng, [["go", "ts"], [], "go", [{ "01": "c" }, { "-0": "ruby" }]]),
    profile: pick(rng, [{ city: "taipei" }, null, "not-obj", [{ city: "tokyo" }]]),
  };
  if (rng() < 0.1) {
    rec.self = rec; // cyclic record
  }
  return rec;
}

test("fuzz: compile, match, explain, and trace invariants across randomized inputs", () => {
  const iters = Number(process.env.FUZZ_ITERATIONS ?? 1500);
  const seed = Number(process.env.FUZZ_SEED ?? 0x517cc1b7);
  const rng = createRng(seed);

  let compiledCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < iters; i++) {
    const cond = randomRootCondition(rng, 3);
    let matcher: ReturnType<typeof mongory.compile>;
    try {
      matcher = mongory.compile(cond, mongory.withMaxDepth(12), mongory.withMaxNodes(128));
      compiledCount++;
    } catch (err) {
      assert.ok(
        err instanceof MongoryError,
        `iteration ${i}: expected MongoryError on invalid condition, got ${String(err)}`,
      );
      rejectedCount++;
      continue;
    }

    const explainText = matcher.explain();
    assert.equal(typeof explainText, "string");
    const explainTree = matcher.explainTree();
    assert.equal(typeof JSON.stringify(explainTree), "string");

    for (let r = 0; r < 2; r++) {
      const rec = randomRecord(rng);
      const matched = matcher.match(rec);
      assert.equal(typeof matched, "boolean");

      const traceRes = matcher.trace(rec);
      assert.equal(traceRes.matched, matched, `iteration ${i}: trace.matched diverged from match`);
      assert.equal(typeof traceRes.trace, "string");

      const traceTreeRes = matcher.traceTree(rec);
      assert.equal(traceTreeRes.matched, matched, `iteration ${i}: traceTree.matched diverged from match`);
      assert.equal(typeof JSON.stringify(traceTreeRes.tree), "string");
    }
  }

  assert.ok(compiledCount > 0, "expected some generated conditions to compile");
  assert.ok(rejectedCount > 0, "expected some hostile conditions to be rejected with MongoryError");
});
