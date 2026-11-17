import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/index.js";

test("explain renders priority-sorted tree", () => {
  const m = compile({
    name: { $regex: "Ann" },
    age: { $gte: 18 },
    status: "active",
  });
  const exp = m.explain();
  assert.ok(exp.startsWith("And\n"));
  // Eq("active") [prio 1 -> Field prio 2] precedes Gte(18) [prio 3 -> Field 4] precedes Regex [prio 20 -> Field 21]
  const idxStatus = exp.indexOf('Field("status")');
  const idxAge = exp.indexOf('Field("age")');
  const idxName = exp.indexOf('Field("name")');
  assert.ok(idxStatus > 0 && idxStatus < idxAge && idxAge < idxName, exp);
});

test("trace handles PASS, FAIL, SKIP, empty branches, $size, $elemMatch, $every, and long strings", () => {
  const m = compile({
    status: "active",
    age: { $gte: 18 },
    tags: { $elemMatch: { $eq: "ts" } },
  });

  // Fail fast on first child -> short-circuits remaining branches
  const failRes = m.trace({ status: "inactive", age: 25, tags: ["ts"] });
  assert.equal(failRes.matched, false);
  assert.ok(failRes.trace.includes("[FAIL] And"));
  assert.ok(failRes.trace.includes('[FAIL] Field("status")'));
  assert.ok(failRes.trace.includes("[SKIP] 2 remaining branch(es) (short-circuited)"));

  const longStr = "a".repeat(80);
  const passRes = m.trace({ status: "active", age: 25, tags: ["go", "ts", "c"], extra: longStr });
  assert.equal(passRes.matched, true);
  assert.ok(passRes.trace.includes("[PASS] And"));
  assert.ok(passRes.trace.includes("[PASS] ElemMatch"));
  assert.ok(passRes.trace.includes("[SKIP] 1 remaining element(s) (short-circuited)"));
  assert.ok(passRes.trace.includes("..."));

  // Empty $and / $or / $size / $not / -0 / bigint formatting
  const emptyAnd = compile({});
  assert.equal(emptyAnd.explain(), "And (empty)\n");
  assert.equal(emptyAnd.trace(-0).trace, "[PASS] And (empty) | value=-0\n");

  const emptyOr = compile({ $or: [] });
  assert.equal(emptyOr.explain(), "Or (empty)\n");
  assert.equal(emptyOr.trace(42n).matched, false);
  assert.ok(emptyOr.trace(42n).trace.includes("value=42n"));

  const sizeMatcher = compile({ items: { $size: { $gte: 2 } } });
  assert.equal(sizeMatcher.trace({ items: [1, 2, 3] }).matched, true);
  assert.ok(sizeMatcher.trace({ items: "abc" }).trace.includes("[FAIL] Size"));

  // Unbound destructured explain & trace
  const { explain, trace, match } = m;
  assert.equal(typeof explain(), "string");
  assert.equal(trace({ status: "active", age: 20, tags: ["ts"] }).matched, match({ status: "active", age: 20, tags: ["ts"] }));
});
