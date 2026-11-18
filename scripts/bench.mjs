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
const cases = [
  { name: "simple", cond: { age: { $gte: 18 } } },
  { name: "or", cond: { $or: [{ age: { $gte: 18 } }, { status: "active" }] } },
  { name: "nested_and", cond: { "profile.city": "taipei", status: "active", age: { $lt: 40 } } },
  { name: "in_array_field", cond: { tags: { $in: ["go", "rust"] } } },
  { name: "large_in_500", cond: { name: { $in: largeList } } },
  { name: "regex", cond: { name: { $regex: "^user[a-f]$" } } },
];

const rounds = 200;
console.log(`Runtime: Node ${process.version} (${process.platform}/${process.arch}), ${N} records x ${rounds} rounds`);
for (const c of cases) {
  const matcher = mongory.compile(c.cond);
  // Warmup
  for (let w = 0; w < 10; w++) matcher.count(records);

  const t0 = performance.now();
  let matched = 0;
  for (let r = 0; r < rounds; r++) {
    matched = matcher.count(records);
  }
  const elapsedMs = performance.now() - t0;
  const nsPerRecord = (elapsedMs * 1e6) / (rounds * N);
  const msPer10k = elapsedMs / rounds;
  console.log(`${c.name.padEnd(16)} ${nsPerRecord.toFixed(1).padStart(7)} ns/rec  ${msPer10k.toFixed(3).padStart(7)} ms/10k  (matched=${matched})`);
}
