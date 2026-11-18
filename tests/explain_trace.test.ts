import assert from "node:assert/strict";
import test from "node:test";
import { compileMatcher, withConverter, withOperator } from "../src/index.js";

test("explain renders priority-sorted tree", () => {
  const m = compileMatcher({
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
  const m = compileMatcher({
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
  const emptyAnd = compileMatcher({});
  assert.equal(emptyAnd.explain(), "And (empty)\n");
  assert.equal(emptyAnd.trace(-0).trace, "[PASS] And (empty) | value=-0\n");

  const emptyOr = compileMatcher({ $or: [] });
  assert.equal(emptyOr.explain(), "Or (empty)\n");
  assert.equal(emptyOr.trace(42n).matched, false);
  assert.ok(emptyOr.trace(42n).trace.includes("value=42n"));

  const sizeMatcher = compileMatcher({ items: { $size: { $gte: 2 } } });
  assert.equal(sizeMatcher.trace({ items: [1, 2, 3] }).matched, true);
  assert.ok(sizeMatcher.trace({ items: "abc" }).trace.includes("[FAIL] Size"));

  // Unbound destructured explain & trace
  const { explain, trace, match } = m;
  assert.equal(typeof explain(), "string");
  assert.equal(trace({ status: "active", age: 20, tags: ["ts"] }).matched, match({ status: "active", age: 20, tags: ["ts"] }));
});

test("explainTree returns priority-ordered structured AST nodes", () => {
  const m = compileMatcher({
    name: { $regex: "Ann" },
    age: { $gte: 18 },
    status: "active",
  });

  const tree = m.explainTree();
  assert.equal(tree.kind, "and");
  assert.equal(tree.operator, "$and");
  assert.equal(tree.children.length, 3);

  assert.deepEqual(
    tree.children.map((c) => c.field),
    ["status", "age", "name"],
  );
  assert.deepEqual(
    tree.children.map((c) => c.order),
    [0, 1, 2],
  );
  assert.ok(tree.children[0].priority <= tree.children[1].priority);
  assert.ok(tree.children[1].priority <= tree.children[2].priority);

  assert.equal(tree.children[0].children[0].kind, "operator");
  assert.equal(tree.children[0].children[0].operator, "$eq");
  assert.equal(tree.children[1].children[0].operator, "$gte");
  assert.equal(tree.children[2].children[0].operator, "$regex");

  const emptyAnd = compileMatcher({}).explainTree();
  assert.equal(emptyAnd.kind, "and");
  assert.equal(emptyAnd.detail, "empty");

  const emptyOr = compileMatcher({ $or: [] }).explainTree();
  assert.equal(emptyOr.kind, "or");
  assert.equal(emptyOr.detail, "empty");

  const { explainTree } = m;
  assert.deepEqual(explainTree(), tree);
});

test("traceTree records PASS, FAIL, and recursive SKIP short-circuit states", () => {
  const andMatcher = compileMatcher({
    status: "active",
    age: { $gte: 18 },
    tags: { $elemMatch: { $eq: "ts" } },
  });

  const failFast = andMatcher.traceTree({ status: "inactive", age: 25, tags: ["ts"] });
  assert.equal(failFast.matched, false);
  assert.equal(failFast.tree.kind, "and");
  assert.equal(failFast.tree.status, "FAIL");
  assert.equal(failFast.tree.children.length, 3);
  assert.equal(failFast.tree.children[0].status, "FAIL");
  assert.equal(failFast.tree.children[0].field, "status");
  assert.equal(failFast.tree.children[0].value, "inactive");

  // Sibling subtrees after short-circuit are recursively marked SKIP
  const skippedAge = failFast.tree.children[1];
  assert.equal(skippedAge.status, "SKIP");
  assert.equal(skippedAge.detail, "short-circuited");
  assert.equal(skippedAge.children[0].status, "SKIP");
  assert.equal(skippedAge.children[0].detail, "short-circuited");

  const skippedTags = failFast.tree.children[2];
  assert.equal(skippedTags.status, "SKIP");
  assert.equal(skippedTags.children[0].kind, "elemMatch");
  assert.equal(skippedTags.children[0].status, "SKIP");

  // $or short-circuits remaining branches on first PASS
  const orMatcher = compileMatcher({
    $or: [{ role: "admin" }, { active: true }],
  });
  const orPass = orMatcher.traceTree({ role: "admin", active: false });
  assert.equal(orPass.matched, true);
  assert.equal(orPass.tree.kind, "or");
  assert.equal(orPass.tree.children[0].status, "PASS");
  assert.equal(orPass.tree.children[1].status, "SKIP");
  assert.equal(orPass.tree.children[1].detail, "short-circuited");

  // $not inverts inner status
  const notMatcher = compileMatcher({ status: { $not: "banned" } });
  const notRes = notMatcher.traceTree({ status: "active" });
  assert.equal(notRes.matched, true);
  const notNode = notRes.tree.children[0];
  assert.equal(notNode.kind, "not");
  assert.equal(notNode.operator, "$not");
  assert.equal(notNode.status, "PASS");
  assert.equal(notNode.children[0].status, "FAIL");

  const { traceTree } = andMatcher;
  assert.deepEqual(traceTree({ status: "inactive", age: 25, tags: ["ts"] }), failFast);
});

test("traceTree handles arrays ($elemMatch/$every/$size), non-container, missing, and custom/converter nodes", () => {
  // $elemMatch element + skip node
  const elemMatcher = compileMatcher({ tags: { $elemMatch: { $eq: "ts" } } });
  const elemRes = elemMatcher.traceTree({ tags: ["go", "ts", "c"] });
  assert.equal(elemRes.matched, true);
  const elemNode = elemRes.tree.children[0];
  assert.equal(elemNode.kind, "elemMatch");
  assert.equal(elemNode.children.length, 3);
  assert.equal(elemNode.children[0].kind, "element");
  assert.equal(elemNode.children[0].index, 0);
  assert.equal(elemNode.children[0].status, "FAIL");
  assert.equal(elemNode.children[1].kind, "element");
  assert.equal(elemNode.children[1].index, 1);
  assert.equal(elemNode.children[1].status, "PASS");
  assert.equal(elemNode.children[2].kind, "skip");
  assert.equal(elemNode.children[2].status, "SKIP");
  assert.equal(elemNode.children[2].skippedCount, 1);
  assert.equal(elemNode.children[2].detail, "short-circuited");

  // Empty array & non-array inside $elemMatch / $every
  const emptyArr = elemMatcher.traceTree({ tags: [] });
  assert.equal(emptyArr.matched, false);
  assert.equal(emptyArr.tree.children[0].detail, "empty-array");
  assert.equal(emptyArr.tree.children[0].children[0].status, "SKIP");
  assert.equal(emptyArr.tree.children[0].children[0].detail, "empty-array");

  const everyMatcher = compileMatcher({ scores: { $every: { $gte: 60 } } });
  const everyNonArr = everyMatcher.traceTree({ scores: "bad" });
  assert.equal(everyNonArr.matched, false);
  assert.equal(everyNonArr.tree.children[0].kind, "every");
  assert.equal(everyNonArr.tree.children[0].detail, "non-array");
  assert.equal(everyNonArr.tree.children[0].children[0].status, "SKIP");

  const everyShortCircuit = everyMatcher.traceTree({ scores: [80, 40, 95] });
  assert.equal(everyShortCircuit.matched, false);
  assert.equal(everyShortCircuit.tree.children[0].children[2].kind, "skip");
  assert.equal(everyShortCircuit.tree.children[0].children[2].skippedCount, 1);

  // $size on array and non-array
  const sizeMatcher = compileMatcher({ items: { $size: { $gte: 2 } } });
  const sizePass = sizeMatcher.traceTree({ items: [1, 2, 3] });
  assert.equal(sizePass.matched, true);
  assert.equal(sizePass.tree.children[0].kind, "size");
  assert.equal(sizePass.tree.children[0].value, 3);
  const sizeFail = sizeMatcher.traceTree({ items: "abc" });
  assert.equal(sizeFail.matched, false);
  assert.equal(sizeFail.tree.children[0].detail, "non-array");
  assert.equal(sizeFail.tree.children[0].children[0].status, "SKIP");
  assert.equal(sizeFail.tree.children[0].children[0].detail, "non-array");

  // Non-container field extraction + missing field snapshot
  const nestedMatcher = compileMatcher({ "profile.age": { $gte: 18 } });
  const nonContainer = nestedMatcher.traceTree({ profile: 42 });
  assert.equal(nonContainer.matched, false);
  assert.equal(nonContainer.tree.kind, "field");
  assert.equal(nonContainer.tree.field, "profile");
  assert.equal(nonContainer.tree.status, "FAIL");
  assert.equal(nonContainer.tree.children[0].field, "age");
  assert.equal(nonContainer.tree.children[0].status, "FAIL");
  assert.equal(nonContainer.tree.children[0].detail, "non-container");
  assert.equal(nonContainer.tree.children[0].children[0].status, "SKIP");
  assert.equal(nonContainer.tree.children[0].children[0].detail, "non-container");

  const missingField = nestedMatcher.traceTree({});
  assert.equal(missingField.matched, false);
  assert.equal(missingField.tree.exists, false);
  assert.equal(missingField.tree.valueText, "<missing>");
  assert.equal("value" in missingField.tree, false);
  assert.equal(missingField.tree.children[0].status, "FAIL");
  assert.equal(missingField.tree.children[0].detail, "non-container");

  // ConvValueNode (RegExp + null) & CustomOpNode
  class Wrapper {
    constructor(readonly raw: string | null) {}
  }
  const customMatcher = compileMatcher(
    {
      label: /^ok/i,
      empty: null,
      code: { $starts: "MN-" },
    },
    withConverter(Wrapper, (w) => w.raw),
    withOperator("$starts", {
      compile(prefix) {
        return (val, exists) => exists && typeof val === "string" && val.startsWith(String(prefix));
      },
    }),
  );
  const customRes = customMatcher.traceTree({
    label: new Wrapper("OK-1"),
    empty: new Wrapper(null),
    code: "MN-42",
  });
  assert.equal(customRes.matched, true);
  assert.equal(customRes.tree.status, "PASS");
  const customLeaf = customRes.tree.children.find((c) => c.field === "code")?.children[0];
  assert.equal(customLeaf?.kind, "custom");
  assert.equal(customLeaf?.operator, "$starts");
  const expCustom = customMatcher.explainTree();
  assert.equal(expCustom.children.find((c) => c.field === "code")?.children[0].kind, "custom");
});

test("traceTree snapshot output is always JSON-serializable for exotic and cyclic values", () => {
  const m = compileMatcher({ v: { $exists: true } });

  const sample = {
    big: 42n,
    nan: Number.NaN,
    posInf: Number.POSITIVE_INFINITY,
    negInf: Number.NEGATIVE_INFINITY,
    negZero: -0,
    date: new Date("2025-01-01T00:00:00.000Z"),
    long: "x".repeat(80),
    wideArr: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    zDeep: { a: { b: { c: { d: 1 } } } },
  };

  const res = m.traceTree({ v: sample });
  assert.equal(res.matched, true);
  const parsed = JSON.parse(JSON.stringify(res)) as {
    matched: boolean;
    tree: { children: Array<{ value: Record<string, unknown> }> };
  };
  const snap = parsed.tree.children[0].value;
  assert.equal(snap.big, "42n");
  assert.equal(snap.nan, "NaN");
  assert.equal(snap.posInf, "Infinity");
  assert.equal(snap.negInf, "-Infinity");
  assert.equal(snap.negZero, "-0");
  assert.equal(snap.date, "2025-01-01T00:00:00.000Z");
  assert.ok(typeof snap.long === "string" && snap.long.endsWith("..."));
  assert.deepEqual((snap.wideArr as unknown[]).slice(-1), ["...(+2)"]);
  assert.equal(snap["..."], "(+1 keys)");

  const cyclic: Record<string, unknown> = { ok: true };
  cyclic.self = cyclic;
  const cycParsed = JSON.parse(JSON.stringify(m.traceTree({ v: cyclic }))) as {
    tree: { children: Array<{ value: Record<string, unknown> }> };
  };
  assert.equal(cycParsed.tree.children[0].value.self, "<cycle>");
});

test("lazy arrayRecord build updates Field and root priority in traceTree and explainTree", () => {
  const m = compileMatcher({
    scores: { $size: { $gte: 3, $lte: 5 }, $every: { $gte: 60 } },
    tags: "ts",
    reviews: { approved: true, rating: { $gte: 4 } },
  });

  const before = m.explainTree();
  assert.equal(before.priority, 34);
  assert.deepEqual(
    before.children.map((c) => [c.field, c.priority]),
    [
      ["tags", 3],
      ["reviews", 11],
      ["scores", 19],
    ],
  );

  const trace = m.traceTree({
    candidate: "Alice",
    tags: ["go", "ts", "rust"],
    scores: [82, 91, 77],
    reviews: [
      { reviewer: "r1", approved: false, rating: 5 },
      { reviewer: "r2", approved: true, rating: 5 },
      { reviewer: "r3", approved: true, rating: 4 },
    ],
  });
  assert.equal(trace.matched, true);
  assert.equal(trace.tree.priority, 40);
  assert.deepEqual(
    trace.tree.children.map((c) => [c.field, c.priority, c.children[0]?.priority]),
    [
      ["tags", 6, 4],
      ["reviews", 14, 12],
      ["scores", 19, 17],
    ],
  );

  const after = m.explainTree();
  assert.equal(after.priority, 40);
  assert.deepEqual(
    after.children.map((c) => [c.field, c.priority]),
    [
      ["tags", 6],
      ["reviews", 14],
      ["scores", 19],
    ],
  );
  assert.equal(after.children[0].children[0].operator, "$elemMatch");
  assert.equal(after.children[1].children[0].operator, "$elemMatch");

  // Nested array inside $elemMatch updates element wrapper + skip priorities + outer priority
  const nested = compileMatcher({
    groups: { $elemMatch: { tags: "ts" } },
  });
  assert.equal(nested.explainTree().priority, 8);
  const nestedTrace = nested.traceTree({
    groups: [{ tags: ["go", "ts"] }, { tags: ["rust"] }],
  });
  assert.equal(nestedTrace.matched, true);
  const elemMatchNode = nestedTrace.tree.children[0];
  assert.equal(elemMatchNode.children[0].priority, 6);
  assert.equal(elemMatchNode.children[1].priority, 6);
  assert.equal(nestedTrace.tree.priority, 11);

  // ExtLiteralNode with converter inherits the same priority & explain behavior
  const ext = compileMatcher(
    { tags: "ts" },
    withConverter(Set, (s) => Array.from(s)),
  );
  assert.equal(ext.explainTree().priority, 3);
  const extTrace = ext.traceTree({ tags: new Set(["go", "ts"]) });
  assert.equal(extTrace.matched, true);
  assert.equal(extTrace.tree.priority, 6);
  assert.equal(ext.explainTree().priority, 6);
});

test("lazy arrayRecord build re-sorts sibling matchers in And, Or, and nested arrays", () => {
  const m = compileMatcher({
    tags: "ts",
    age: { $gte: 18 },
    items: { $size: { $gte: 1 } },
  });

  // Initial order: tags (3) < age (5) < items (8)
  assert.deepEqual(
    m.explainTree().children.map((c) => [c.field, c.priority]),
    [
      ["tags", 3],
      ["age", 5],
      ["items", 8],
    ],
  );

  // Triggering arrayRecord on tags raises tags to 6 (> age 5, < items 8)
  assert.equal(m.match({ tags: ["go", "ts"], age: 20, items: [1] }), true);

  // Subsequent explainTree and traceTree reflect re-sorted order: age (5) < tags (6) < items (8)
  assert.deepEqual(
    m.explainTree().children.map((c) => [c.field, c.priority, c.order]),
    [
      ["age", 5, 0],
      ["tags", 6, 1],
      ["items", 8, 2],
    ],
  );

  // Cheaper age condition now runs first and short-circuits before scanning tags/items arrays
  const fastFail = m.traceTree({ tags: ["go", "ts"], age: 15, items: [1] });
  assert.equal(fastFail.matched, false);
  assert.equal(fastFail.tree.priority, 20);
  assert.equal(fastFail.tree.children[0].field, "age");
  assert.equal(fastFail.tree.children[0].status, "FAIL");
  assert.equal(fastFail.tree.children[1].field, "tags");
  assert.equal(fastFail.tree.children[1].status, "SKIP");
  assert.equal(fastFail.tree.children[2].field, "items");
  assert.equal(fastFail.tree.children[2].status, "SKIP");

  // $or branches also re-sort when a branch triggers arrayRecord
  const orMatcher = compileMatcher({
    $or: [{ tags: "ts" }, { age: { $gte: 18 } }],
  });
  assert.deepEqual(
    orMatcher.explainTree().children.map((c) => [c.field, c.priority]),
    [
      ["tags", 3],
      ["age", 5],
    ],
  );
  // First branch passes immediately on { tags: ["go", "ts"], age: 10 }, sorting Or to [age(5), tags(6)]
  assert.equal(orMatcher.match({ tags: ["go", "ts"], age: 10 }), true);
  assert.deepEqual(
    orMatcher.explainTree().children.map((c) => [c.field, c.priority]),
    [
      ["age", 5],
      ["tags", 6],
    ],
  );
});
