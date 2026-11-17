import assert from "node:assert/strict";
import test from "node:test";
import {
  MISSING,
  MongoryInvalidConditionError,
  MongoryInvalidOptionError,
  mongoryAnd as and,
  compileMatcher as compile,
  mongory,
  mongoryOr as or,
  withConverter,
  withField,
  withFieldResolver,
  withOperator,
  withOptions,
} from "../src/index.js";

class Money {
  constructor(
    public readonly currency: string,
    public readonly amount: number,
  ) {}
}

class ObjectId {
  constructor(private readonly hex: string) {}
  toHexString(): string {
    return this.hex;
  }
}

interface CustomBox {
  readonly kind: "box";
  readonly inner: unknown;
}

const isBox = (v: unknown): v is CustomBox =>
  typeof v === "object" && v !== null && (v as CustomBox).kind === "box";

test("withOptions preset, override precedence, and option errors", () => {
  const base = withOptions(
    null,
    undefined,
    withConverter(ObjectId, (id) => id.toHexString()),
    withField<{ first: string; last: string }>("fullName", (u) => `${u.first} ${u.last}`),
  );
  // Later option overrides earlier converter
  const overridden = withOptions(
    base,
    withConverter(ObjectId, (id) => id.toHexString().toUpperCase()),
  );

  const m = compile({ id: "ABC", fullName: "Ann Lee" }, overridden);
  assert.equal(m.match({ id: new ObjectId("abc"), first: "Ann", last: "Lee" }), true);

  // Invalid options produce MongoryInvalidOptionError (not MongoryInvalidConditionError)
  for (const badOpt of [
    withConverter(Object as never, () => 1),
    withConverter("nope" as never, () => 1),
    withField("", () => 1),
    withFieldResolver("nope" as never),
    withOperator("noDollar", { compile: () => () => true }),
    withOperator("$", { compile: () => () => true }),
    withOperator("$eq", { compile: () => () => true }),
    withOperator("$regex", { compile: () => () => true }),
    withOperator("$options", { compile: () => () => true }),
    withOperator("$custom", { compile: null as never }),
  ]) {
    assert.throws(() => compile({}, badOpt), (err: unknown) => {
      assert.ok(err instanceof MongoryInvalidOptionError);
      assert.equal(err instanceof MongoryInvalidConditionError, false);
      return true;
    });
  }
});

test("withConverter works symmetrically without infinite loops and covers $in/$present/null", () => {
  class HopA {
    constructor(public readonly n: number) {}
  }
  class HopB {
    constructor(public readonly label: string) {}
  }
  const boxOpt = withConverter(isBox, (b) => b.inner);
  const noChainOpt = withOptions(
    withConverter(HopA, () => new HopB("step1")),
    withConverter(HopB, (b) => b.label),
  );

  // Non-chaining: HopB("final") -> "final" at compile, HopA(1) converts once to HopB("step1") and stops
  const mNoChain = compile({ id: new HopB("final") }, noChainOpt);
  assert.equal(mNoChain.match({ id: new HopA(1) }), false);
  assert.equal(mNoChain.match({ id: new HopB("final") }), true);

  // One-hop converter to non-plain value object still matches structurally
  const mOneHop = compile({ id: new HopB("step1") }, withConverter(HopA, () => new HopB("step1")));
  assert.equal(mOneHop.match({ id: new HopA(1) }), true);

  // Converter turning a container class into an array supports implicit array matching and $size
  class TagList {
    constructor(public readonly tags: string[]) {}
  }
  const tagMatcher = compile(
    { tags: "ts", countCheck: { $size: 2 } },
    withOptions(
      withConverter(TagList, (t) => t.tags),
      withField<{ tags: TagList }>("countCheck", (r) => r.tags),
    ),
  );
  // Also direct converter array container on $size inside Eq/array field
  const tagArr = compile(
    { tags: "ts", lenOk: { $exists: true } },
    withConverter(TagList, (t) => t.tags),
  );
  assert.equal(tagArr.match({ tags: new TagList(["go", "ts"]), lenOk: true }), true);
  assert.equal(tagMatcher.trace({ tags: new TagList(["go", "ts"]) }).matched, true);
  assert.equal(compile({ tags: "py" }, withConverter(TagList, (t) => t.tags)).match({ tags: new TagList(["go", "ts"]) }), false);

  const many = Array.from({ length: 20 }, (_, i) => `k-${i}`);
  const opts = withOptions(
    boxOpt,
    withConverter(ObjectId, (id) => id.toHexString()),
  );

  const cond = {
    id: new ObjectId("k-19"),
    score: { $gte: 10 },
    tag: { $in: many },
    empty: null,
    opt: { $present: false },
  };
  const m = compile(cond, opts);
  const rec = {
    id: new ObjectId("k-19"),
    score: { kind: "box", inner: 15 },
    tag: { kind: "box", inner: "k-3" },
    empty: { kind: "box", inner: null },
    opt: { kind: "box", inner: "" },
  };
  assert.equal(m.match(rec), true);
  assert.equal(m.trace(rec).matched, true);

  // Nested objects and arrays inside $eq / $in / $nin with converter
  const nestedDocMatcher = compile(
    {
      doc: { $eq: { id: "oid-1", tags: ["oid-2"] } },
      list: { $in: [...many, { id: "oid-1" }] },
    },
    opts,
  );
  const nestedRec = {
    doc: { id: new ObjectId("oid-1"), tags: [new ObjectId("oid-2")] },
    list: [{ id: new ObjectId("oid-1") }],
  };
  assert.equal(nestedDocMatcher.match(nestedRec), true);
  assert.equal(nestedDocMatcher.trace(nestedRec).matched, true);
  assert.equal(
    compile({ list: { $in: [{ id: "oid-1" }] } }, opts).match({ list: [{ id: new ObjectId("oid-9") }] }),
    false,
  );
  assert.equal(
    compile({ doc: { $ne: { id: "oid-1" } } }, opts).match({ doc: { id: new ObjectId("oid-2") } }),
    true,
  );
});

test("withField and withFieldResolver precedence, Map support, and MISSING", () => {
  class Order {
    secret = "should-hide";
    subtotal = 100;
  }
  const opts = withOptions(
    withFieldResolver(Order, (_o, field) => {
      if (field === "secret") return MISSING;
      if (field === "tax") return 8;
      return undefined; // fall through
    }),
    withField(Order, "tax", (o) => o.subtotal * 0.1), // higher precedence than resolver
    withFieldResolver(Map, (m, field) => (m.has(field) ? m.get(field) : MISSING)),
  );

  const orderMatcher = compile(
    { subtotal: 100, tax: 10, secret: { $exists: false } },
    opts,
  );
  const order = new Order();
  assert.equal(orderMatcher.match(order), true);
  assert.equal(orderMatcher.trace(order).matched, true);

  const mapMatcher = compile({ role: "admin", absent: { $exists: false } }, opts);
  const mapRec = new Map<string, unknown>([["role", "admin"]]);
  assert.equal(mapMatcher.match(mapRec), true);
});

test("withOperator preserves raw args/values, honors MatchElements, and inherits in arrays (B1-B4)", () => {
  const moneyOpt = withOptions(
    withConverter(Money, (m) => m.amount), // converter must NOT strip Money before $moneyGte
    withOperator("$moneyGte", {
      matchElements: true,
      priority: 4,
      compile(arg) {
        if (!(arg instanceof Money)) {
          throw new Error("$moneyGte requires Money instance");
        }
        return (val, exists) =>
          exists && val instanceof Money && val.currency === arg.currency && val.amount >= arg.amount;
      },
    }),
    withOperator("$alwaysPresent", {
      matchElements: false,
      compile() {
        return (_val, exists) => exists;
      },
    }),
  );

  // Invalid custom op condition throws MongoryInvalidConditionError
  assert.throws(
    () => compile({ price: { $moneyGte: 100 } }, moneyOpt),
    MongoryInvalidConditionError,
  );

  // Raw Money arg + raw Money record + scalar converter coexistence + array element match (B2 & B3)
  const m = compile(
    {
      price: { $moneyGte: new Money("USD", 100), $gte: 100 },
      prices: { $moneyGte: new Money("USD", 50) },
      pricesList: { $alwaysPresent: true },
    },
    moneyOpt,
  );

  const good = {
    price: new Money("USD", 120),
    prices: [new Money("TWD", 500), new Money("USD", 60)],
    pricesList: [],
  };
  const wrongCurrency = {
    price: new Money("TWD", 120),
    prices: [new Money("USD", 60)],
    pricesList: [],
  };

  assert.equal(m.match(good), true);
  assert.equal(m.trace(good).matched, true);
  assert.equal(m.match(wrongCurrency), false);
  assert.equal(m.trace(wrongCurrency).matched, false);

  // Missing vs explicit null passed to Predicate(value, exists)
  let seenArgs: Array<{ val: unknown; exists: boolean }> = [];
  const probe = compile(
    {
      field: { $probe: true },
    },
    withOperator("$probe", {
      compile() {
        return (val, exists) => {
          seenArgs.push({ val, exists });
          return exists;
        };
      },
    }),
  );
  assert.equal(probe.match({}), false);
  assert.equal(probe.match({ field: null }), true);
  assert.deepEqual(seenArgs, [
    { val: undefined, exists: false },
    { val: null, exists: true },
  ]);
});

test("and and or combinators semantics, immutability, deduplication, and empty semantics", () => {
  const c1: Record<string, unknown> = { status: "active", price: { $gte: 10 } };
  const c2: Record<string, unknown> = { price: { $lte: 50 }, "meta.tier": "gold" };
  const combined = and(null, undefined, {}, c1, c2, { status: "active" });

  // Caller inputs untouched
  assert.deepEqual(c1.price, { $gte: 10 });
  assert.deepEqual(c2.price, { $lte: 50 });

  assert.deepEqual(combined, {
    status: "active",
    price: { $gte: 10, $lte: 50 },
    "meta.tier": "gold",
  });

  // Regex + $options must NOT merge across clauses by key disjointness
  const regexConflict = and({ name: { $regex: "^a" } }, { name: { $options: "i" } });
  assert.throws(() => compile(regexConflict), MongoryInvalidConditionError);

  // Key conflicts preserved inside $and
  const conflict = and({ a: 1 }, { a: 2 });
  assert.equal(compile(conflict).match({ a: 1 }), false);

  // Or semantics: empty/nil skipped, explicit {} absorbs, no branches -> fail-closed
  assert.deepEqual(or(), { $or: [] });
  assert.equal(compile(or()).match({ a: 1 }), false);
  assert.deepEqual(or(null, undefined, { $or: [] }), { $or: [] });
  assert.deepEqual(or({ status: "a" }, {}, { status: "b" }), {});
  assert.equal(compile(or({ status: "a" }, {}, { status: "b" })).match({}), true);
  assert.deepEqual(or({ $or: [{ a: 1 }, { b: 2 }] }, { a: 1 }, null), { $or: [{ a: 1 }, { b: 2 }] });
  assert.deepEqual(mongory.and({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  assert.deepEqual(mongory.or({ a: 1 }, { b: 2 }), { $or: [{ a: 1 }, { b: 2 }] });
});
