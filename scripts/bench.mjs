import { mongory } from "../dist/esm/index.js";

const N = 10_000;
const records = Array.from({ length: N }, (_, i) => ({
  id: i,
  name: i % 5 === 0 ? `user${"abcdef"[i % 6]}` : `other_${i}`,
  age: 10 + (i % 50),
  status: i % 3 === 0 ? "active" : "inactive",
  tags: i % 4 === 0 ? ["go", "ts"] : ["ruby", "c"],
  profile: { city: i % 2 === 0 ? "taipei" : "tokyo" },
}));

const largeList = Array.from({ length: 500 }, (_, i) => `user_${i}`);
const largeSet = new Set(largeList);
const re = /^user[a-f]$/;

const cases = [
  {
    name: "simple",
    cond: { age: { $gte: 18 } },
    plain: (r) => typeof r.age === "number" && r.age >= 18,
  },
  {
    name: "or",
    cond: { $or: [{ age: { $gte: 18 } }, { status: "active" }] },
    plain: (r) => (typeof r.age === "number" && r.age >= 18) || r.status === "active",
  },
  {
    name: "nested_and",
    cond: { "profile.city": "taipei", status: "active", age: { $lt: 40 } },
    plain: (r) =>
      r.profile?.city === "taipei" && r.status === "active" && typeof r.age === "number" && r.age < 40,
  },
  {
    name: "in_array_field",
    cond: { tags: { $in: ["go", "rust"] } },
    plain: (r) => Array.isArray(r.tags) && r.tags.some((t) => t === "go" || t === "rust"),
  },
  {
    name: "large_in_500",
    cond: { name: { $in: largeList } },
    plain: (r) => largeSet.has(r.name),
  },
  {
    name: "regex",
    cond: { name: { $regex: "^user[a-f]$" } },
    plain: (r) => typeof r.name === "string" && re.test(r.name),
  },
];

const rounds = 200;

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
    msPer10k: elapsedMs / rounds,
    matched,
  };
}

console.log(`Runtime: Node ${process.version} (${process.platform}/${process.arch}), ${N} records x ${rounds} rounds`);
for (const c of cases) {
  const matcher = mongory.compile(c.cond);
  const plainRes = measure(() => {
    let n = 0;
    for (let i = 0; i < records.length; i++) {
      if (c.plain(records[i])) n++;
    }
    return n;
  });
  const mongoryRes = measure(() => matcher.count(records));
  console.log(
    `${c.name.padEnd(16)} plain=${plainRes.nsPerRec.toFixed(1).padStart(5)} ns/rec  mongory=${mongoryRes.nsPerRec.toFixed(1).padStart(5)} ns/rec  (ratio=${(mongoryRes.nsPerRec / plainRes.nsPerRec).toFixed(2)}x, matched=${mongoryRes.matched})`,
  );
}
