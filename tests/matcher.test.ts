import assert from "node:assert/strict";
import test from "node:test";
import * as rootModule from "../src/index.js";
import defaultMongory, {
  Matcher,
  MongoryInvalidConditionError,
  compileMatcher,
  matchCondition,
  mongory,
} from "../src/index.js";

test("public exports avoid generic bare names while supporting namespace and named entrypoints", () => {
  assert.equal(defaultMongory, mongory);
  assert.equal(typeof mongory.compile, "function");
  assert.equal(typeof mongory.match, "function");
  assert.equal(typeof mongory.and, "function");
  assert.equal(typeof mongory.or, "function");
  assert.equal(typeof mongory.filterLimit, "function");

  for (const commonName of ["and", "or", "compile", "match", "filter", "filterLimit", "find", "any", "count"]) {
    assert.equal(Object.hasOwn(rootModule, commonName), false, `unexpected bare export ${commonName}`);
  }
});

test("top-level empty conditions match everything and non-documents fail", () => {
  for (const empty of [undefined, null, {}]) {
    const m = compileMatcher(empty);
    assert.ok(m instanceof Matcher);
    assert.equal(m.match({ name: "Ann" }), true);
    assert.equal(m.match(null), true);
    assert.equal(m.match(undefined), true);
    assert.equal(m.match(42), true);
    assert.equal(m.match([]), true);
  }

  for (const invalid of [42, "str", true, [], new Date(), /abc/, () => {}]) {
    assert.throws(
      () => compileMatcher(invalid as unknown as Record<string, unknown>),
      MongoryInvalidConditionError,
    );
  }
});

test("matcher unbound methods, namespace helpers, and collection helpers", () => {
  const users = [
    { name: "Ann", age: 30 },
    { name: "Bob", age: 15 },
    { name: "Cid", age: 25 },
    { name: "Dan", age: 40 },
  ];
  const m = mongory.compile({ age: { $gte: 18 } });

  assert.deepEqual(users.filter(m.match), [
    { name: "Ann", age: 30 },
    { name: "Cid", age: 25 },
    { name: "Dan", age: 40 },
  ]);
  assert.equal(users.some(m.match), true);

  assert.deepEqual(mongory.filter(users, m), [users[0], users[2], users[3]]);
  assert.deepEqual(m.filter(new Set(users)), [users[0], users[2], users[3]]);
  assert.deepEqual(mongory.filterLimit(users, m, 2), [users[0], users[2]]);
  assert.deepEqual(m.filterLimit(users, 0), []);
  assert.deepEqual(m.filterLimit(users, NaN), []);
  assert.deepEqual(m.filterLimit(users, -1), [users[0], users[2], users[3]]);
  assert.deepEqual(m.filterLimit(users, Infinity), [users[0], users[2], users[3]]);
  assert.deepEqual(mongory.find(users, m), users[0]);
  assert.equal(m.find([]), undefined);
  assert.equal(mongory.any(users, m), true);
  assert.equal(m.any([{ age: 10 }]), false);
  assert.equal(mongory.count(users, m), 3);
  assert.equal(m.count(users), 3);
  assert.equal(matchCondition({ age: { $lt: 18 } }, users[1]), true);
  assert.equal(mongory.match({ age: { $lt: 18 } }, users[1]), true);
});

test("numeric precision: bigint, -0, NaN, Infinity", () => {
  // 2^53 = 9007199254740992 vs 2^53 + 1 = 9007199254740993n
  assert.equal(matchCondition({ id: 9007199254740992 }, { id: 9007199254740993n }), false);
  assert.equal(matchCondition({ id: { $gt: 9007199254740992 } }, { id: 9007199254740993n }), true);
  assert.equal(matchCondition({ id: { $lt: 9007199254740993n } }, { id: 9007199254740992 }), true);
  assert.equal(matchCondition({ id: 9007199254740993n }, { id: 9007199254740993n }), true);
  assert.equal(matchCondition({ n: 42n }, { n: 42 }), true);
  assert.equal(matchCondition({ n: { $gt: -3.5 } }, { n: -3n }), true);
  assert.equal(matchCondition({ n: { $lt: 3.5 } }, { n: 3n }), true);
  assert.equal(matchCondition({ n: { $gt: Infinity } }, { n: 10n ** 100n }), false);
  assert.equal(matchCondition({ n: { $lt: Infinity } }, { n: 10n ** 100n }), true);

  // -0 vs 0
  assert.equal(matchCondition({ n: 0 }, { n: -0 }), true);
  assert.equal(matchCondition({ n: -0 }, { n: 0 }), true);

  // NaN matches nothing for $eq/$gt/$gte/$lt/$lte/$in, matches $ne/$nin
  assert.equal(matchCondition({ n: NaN }, { n: NaN }), false);
  assert.equal(matchCondition({ n: { $ne: NaN } }, { n: NaN }), true);
  assert.equal(matchCondition({ n: { $gt: 0 } }, { n: NaN }), false);
  assert.equal(matchCondition({ n: { $lt: 0 } }, { n: NaN }), false);
  assert.equal(matchCondition({ n: { $in: [NaN, 1] } }, { n: NaN }), false);
  assert.equal(matchCondition({ n: { $nin: [NaN, 1] } }, { n: NaN }), true);
});

test("Date and Uint8Array comparisons", () => {
  const t1 = new Date("2026-01-01T00:00:00Z");
  const t2 = new Date("2026-01-02T00:00:00Z");
  const m = compileMatcher({ at: { $gte: t1, $lt: t2 } });
  assert.equal(m.match({ at: new Date("2026-01-01T12:00:00Z") }), true);
  assert.equal(m.match({ at: new Date(t2.getTime()) }), false);
  assert.equal(m.match({ at: new Date(NaN) }), false);
  assert.equal(matchCondition({ "at.getTime": { $exists: true } }, { at: t1 }), false);
  assert.equal(matchCondition({ at: { $present: true } }, { at: t1 }), true);

  // Uint8Array is binary scalar, NOT list
  const id = new Uint8Array([1, 2, 3]);
  assert.equal(matchCondition({ id: new Uint8Array([1, 2, 3]) }, { id }), true);
  assert.equal(matchCondition({ id: new Uint8Array([1, 2, 4]) }, { id }), false);
  assert.equal(matchCondition({ id: 1 }, { id }), false);
  assert.equal(matchCondition({ "id.0": 1 }, { id }), false);
  assert.equal(matchCondition({ id: { $size: 3 } }, { id }), false);
});

test("RegExp statelessness, flag validation, and syntax errors", () => {
  // Stateful /g and /y must be stripped so repeated matches stay pure
  const globalRe = /foo/g;
  const stickyRe = /foo/y;
  const m1 = compileMatcher({ name: globalRe });
  const m2 = compileMatcher({ name: { $regex: stickyRe } });
  for (let i = 0; i < 5; i++) {
    assert.equal(m1.match({ name: "x foo" }), true);
    assert.equal(m2.match({ name: "bar foo" }), true);
  }
  assert.equal(globalRe.lastIndex, 0);

  // Repeated flags deduplicated cleanly
  assert.equal(matchCondition({ name: { $regex: "^ann$", $options: "ii" } }, { name: "ANN" }), true);
  assert.equal(matchCondition({ name: { $regex: "a.b", $options: "smi" } }, { name: "X\nA\nB" }), true);

  // RegExp + non-empty $options fails; invalid regex syntax fails
  assert.throws(
    () => compileMatcher({ name: { $regex: /foo/, $options: "i" } }),
    MongoryInvalidConditionError,
  );
  assert.throws(
    () => compileMatcher({ name: { $regex: "[" } }),
    MongoryInvalidConditionError,
  );
});

test("B5 dotted-key leaf collisions, escaped dots, and __proto__ safety", () => {
  // Colliding leaf branches do not overwrite each other
  const m = compileMatcher({ a: 1, "a.b": 2 });
  assert.equal(m.match({ a: 1 }), false);
  assert.equal(m.match({ a: { b: 2 } }), false);

  const rangeAndEq = compileMatcher({ "a.$gt": 1, a: 5 });
  assert.equal(rangeAndEq.match({ a: 5 }), true);
  assert.equal(rangeAndEq.match({ a: 0 }), false);

  // Same-key escaped dot vs dotted path
  const escaped = compileMatcher({ "a\\.b.c": 10 });
  assert.equal(escaped.match({ "a.b": { c: 10 } }), true);
  assert.equal(escaped.match({ a: { b: { c: 10 } } }), false);

  // Prototype pollution and Object.prototype keys must be blocked on records and conditions
  const plainRec = { name: "Ann" };
  assert.equal(matchCondition({ toString: { $exists: true } }, plainRec), false);
  assert.equal(matchCondition({ constructor: { $exists: true } }, plainRec), false);

  const protoCond = JSON.parse('{"__proto__.polluted": true}');
  const protoMatcher = compileMatcher(protoCond);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(protoMatcher.match(plainRec), false);
  assert.equal(protoMatcher.match(JSON.parse('{"__proto__": {"polluted": true}}')), true);
});

test("undefined own properties and class instance records", () => {
  class User {
    constructor(
      public readonly name: string,
      public readonly age?: number,
    ) {}
  }
  const ann = new User("Ann", 30);
  const bob = new User("Bob", undefined);

  assert.equal(matchCondition({ name: "Ann", age: { $gte: 18 } }, ann), true);
  assert.equal(matchCondition({ age: { $exists: false } }, bob), true);
  assert.equal(matchCondition({ age: { $exists: true } }, bob), false);
  assert.equal(matchCondition({ age: null }, bob), true);
  assert.equal(matchCondition({ age: { $eq: null } }, bob), false);
  assert.equal(matchCondition({ age: { $eq: null } }, { age: null }), true);
});

test("compile snapshots input conditions against caller mutation", () => {
  const tags = ["go", "ts"];
  const cond: Record<string, unknown> = { tags: { $in: tags } };
  const m = compileMatcher(cond);
  tags.push("evil");
  cond.tags = "evil";
  assert.equal(m.match({ tags: "ts" }), true);
  assert.equal(m.match({ tags: "evil" }), false);
});
