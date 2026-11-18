import { Query as MingoQuery } from "mingo";
import siftModule from "sift";
import { mongory } from "../dist/esm/index.js";

const sift = siftModule.default ?? siftModule;

const N = 10_000;
const rounds = 200;

// Dataset 1: Monomorphic (uniform hidden class across all 10,000 records)
const monoRecords = Array.from({ length: N }, (_, i) => ({
  id: i,
  name: i % 5 === 0 ? `user${"abcdef"[i % 6]}` : `other_${i}`,
  age: 10 + (i % 50),
  status: i % 3 === 0 ? "active" : "inactive",
  tags: i % 4 === 0 ? ["go", "ts"] : ["ruby", "c"],
  profile: { city: i % 2 === 0 ? "taipei" : "tokyo" },
}));

// Dataset 2: Polymorphic / Heterogeneous (varied hidden classes, missing keys, extra keys, array/scalar mix)
const polyRecords = Array.from({ length: N }, (_, i) => {
  const variant = i % 6;
  const age = variant === 4 ? [10 + (i % 50), 25] : variant === 5 ? String(10 + (i % 50)) : 10 + (i % 50);
  const status = i % 3 === 0 ? "active" : "inactive";
  const name = i % 5 === 0 ? `user${"abcdef"[i % 6]}` : `other_${i}`;
  const tags = variant === 3 ? "go" : i % 4 === 0 ? ["go", "ts"] : ["ruby", "c"];
  const profile = variant === 2 ? null : { city: i % 2 === 0 ? "taipei" : "tokyo", zip: 100 + (i % 900) };

  switch (variant) {
    case 0:
      return { id: i, name, age, status, tags, profile };
    case 1:
      return { status, age, name, tags, profile, extraA: i };
    case 2:
      return { name, status, tags, extraB: true }; // missing age & profile=null
    case 3:
      return { id: i, tags, profile, age, name, extraC: "x" }; // missing status, scalar tags
    case 4:
      return { profile, status, age, name, tags, extraD: i % 2 }; // array age
    default:
      return { age, name, status, profile, tags, extraE: [1, 2] }; // string age
  }
});

// Semantics-equivalent defensive helpers matching Mongo-style field lookup + implicit array matching
function isPlainContainer(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return false;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    if (
      v instanceof Date ||
      v instanceof RegExp ||
      ArrayBuffer.isView(v) ||
      v instanceof ArrayBuffer ||
      v instanceof Map ||
      v instanceof Set
    ) {
      return false;
    }
  }
  return true;
}

const MISSING = Symbol("missing");

function ownProp(obj, key) {
  if (!isPlainContainer(obj) || !Object.hasOwn(obj, key)) {
    return MISSING;
  }
  const v = obj[key];
  return v === undefined ? MISSING : v;
}

function matchMaybeArray(val, pred) {
  if (val === MISSING) return false;
  if (pred(val)) return true;
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      if (pred(val[i])) return true;
    }
  }
  return false;
}

function matchDotPath(obj, k1, k2, pred) {
  const first = ownProp(obj, k1);
  if (first === MISSING) return false;
  if (Array.isArray(first)) {
    for (let i = 0; i < first.length; i++) {
      const sub = ownProp(first[i], k2);
      if (matchMaybeArray(sub, pred)) return true;
    }
    return false;
  }
  return matchMaybeArray(ownProp(first, k2), pred);
}

const largeList = Array.from({ length: 500 }, (_, i) => `user_${i}`);
const largeSet = new Set(largeList);
const re = /^user[a-f]$/;

const cases = [
  {
    name: "simple",
    cond: { age: { $gte: 18 } },
    plainFast: (r) => typeof r.age === "number" && r.age >= 18,
    plainSafe: (r) => matchMaybeArray(ownProp(r, "age"), (v) => typeof v === "number" && v >= 18),
  },
  {
    name: "or",
    cond: { $or: [{ age: { $gte: 18 } }, { status: "active" }] },
    plainFast: (r) => (typeof r.age === "number" && r.age >= 18) || r.status === "active",
    plainSafe: (r) =>
      matchMaybeArray(ownProp(r, "age"), (v) => typeof v === "number" && v >= 18) ||
      matchMaybeArray(ownProp(r, "status"), (v) => v === "active"),
  },
  {
    name: "nested_and",
    cond: { "profile.city": "taipei", status: "active", age: { $lt: 40 } },
    plainFast: (r) =>
      r.profile?.city === "taipei" && r.status === "active" && typeof r.age === "number" && r.age < 40,
    plainSafe: (r) =>
      matchMaybeArray(ownProp(r, "status"), (v) => v === "active") &&
      matchMaybeArray(ownProp(r, "age"), (v) => typeof v === "number" && v < 40) &&
      matchDotPath(r, "profile", "city", (v) => v === "taipei"),
  },
  {
    name: "in_array_field",
    cond: { tags: { $in: ["go", "rust"] } },
    plainFast: (r) => Array.isArray(r.tags) && r.tags.some((t) => t === "go" || t === "rust"),
    plainSafe: (r) => matchMaybeArray(ownProp(r, "tags"), (v) => v === "go" || v === "rust"),
  },
  {
    name: "large_in_500",
    cond: { name: { $in: largeList } },
    plainFast: (r) => largeSet.has(r.name),
    plainSafe: (r) => matchMaybeArray(ownProp(r, "name"), (v) => largeSet.has(v)),
  },
  {
    name: "regex",
    cond: { name: { $regex: "^user[a-f]$" } },
    plainFast: (r) => typeof r.name === "string" && re.test(r.name),
    plainSafe: (r) => matchMaybeArray(ownProp(r, "name"), (v) => typeof v === "string" && re.test(v)),
  },
];

function measure(fn) {
  for (let w = 0; w < 10; w++) fn();
  const t0 = performance.now();
  let matched = 0;
  for (let r = 0; r < rounds; r++) {
    matched = fn();
  }
  const elapsedMs = performance.now() - t0;
  return {
    nsPerRec: (elapsedMs * 1e6) / (rounds * N),
    matched,
  };
}

function countFn(records, pred) {
  let n = 0;
  for (let i = 0, len = records.length; i < len; i++) {
    if (pred(records[i])) n++;
  }
  return n;
}

function runSuite(label, records) {
  console.log(`\n=== ${label} (${N} records x ${rounds} rounds) ===`);
  for (const c of cases) {
    const matcher = mongory.compile(c.cond);
    const siftPred = sift(c.cond);
    const mingoQuery = new MingoQuery(c.cond);

    const fastRes = measure(() => countFn(records, c.plainFast));
    const safeRes = measure(() => countFn(records, c.plainSafe));
    const mongoryRes = measure(() => matcher.count(records));
    const siftRes = measure(() => countFn(records, siftPred));
    const mingoRes = measure(() => countFn(records, (r) => mingoQuery.test(r)));

    console.log(
      `${c.name.padEnd(15)} plain_fast=${fastRes.nsPerRec.toFixed(1).padStart(5)}  plain_safe=${safeRes.nsPerRec.toFixed(1).padStart(5)}  mongory=${mongoryRes.nsPerRec.toFixed(1).padStart(5)}  sift=${siftRes.nsPerRec.toFixed(1).padStart(6)}  mingo=${mingoRes.nsPerRec.toFixed(1).padStart(6)} ns/rec  (mongory/safe=${(mongoryRes.nsPerRec / safeRes.nsPerRec).toFixed(2)}x, matched: safe=${safeRes.matched} mongory=${mongoryRes.matched} sift=${siftRes.matched} mingo=${mingoRes.matched})`,
    );
  }
}

console.log(`Runtime: Node ${process.version} (${process.platform}/${process.arch})`);
runSuite("Monomorphic records", monoRecords);
runSuite("Polymorphic records", polyRecords);
