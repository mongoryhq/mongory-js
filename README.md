# mongory-js

[![npm version](https://img.shields.io/npm/v/mongory-js)](https://www.npmjs.com/package/mongory-js)
[![CI](https://github.com/mongoryhq/mongory-js/actions/workflows/ci.yml/badge.svg)](https://github.com/mongoryhq/mongory-js/actions/workflows/ci.yml)
[![mongory-spec](https://github.com/mongoryhq/mongory-js/actions/workflows/spec-conformance.yml/badge.svg)](https://github.com/mongoryhq/mongory-js/actions/workflows/spec-conformance.yml)
![Node](https://img.shields.io/badge/Node-20%2B-339933)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Zero-dependency TypeScript/JavaScript in-memory MongoDB-style query & rule engine** — with built-in text (`explain()` / `trace()`) and structured AST (`explainTree()` / `traceTree()`) debugging across browsers, Node (`>= 20`), Bun, Deno, and Edge runtimes.

**[Try the Interactive Playground & Visual Explain/Trace Debugger ↗](https://mongoryhq.github.io/mongory-central/)**

[![Mongory Playground & Visual Trace](https://mongoryhq.github.io/mongory-central/playground-trace.png)](https://mongoryhq.github.io/mongory-central/)

> **Ecosystem:** [Playground](https://mongoryhq.github.io/mongory-central/) · [`mongory-go` (Go)](https://github.com/mongoryhq/mongory-go) · [`mongory-py` (Python)](https://github.com/mongoryhq/mongory-py) · [`mongory-rb` (Ruby)](https://github.com/mongoryhq/mongory-rb) · [`mongory-core` (C99)](https://github.com/mongoryhq/mongory-core) · [`mongory-spec`](https://github.com/mongoryhq/mongory-spec)

## Installation

```bash
npm install mongory-js
# or: pnpm add mongory-js / yarn add mongory-js / bun add mongory-js
```

Zero runtime dependencies; ships dual ESM + CJS + `.d.ts` with tree-shakable exports and an optional `mongory-js/op` operator constants subpath.

## Quick Start

```ts
import { mongory } from "mongory-js";

const users = [
  { name: "Ann", age: 30, tags: ["ts", "go"], active: true },
  { name: "Bob", age: 15, tags: ["ruby"], active: true },
  { name: "Cid", age: 42, tags: ["ts", "c"], active: false },
];

// 1. One-off evaluation
const isAdult = mongory.match({ age: { $gte: 18 } }, users[0]); // true

// 2. Compile once, reuse across arrays/iterables
const isEligible = mongory.compile(
  mongory.and(
    { active: true },
    mongory.or({ tags: "ts" }, { age: { $lt: 18 } }),
  ),
);

const matched = users.filter(isEligible.match); // [Ann, Bob]
const first = users.find(isEligible.match);     // Ann
const top1 = isEligible.filterLimit(users, 1);  // [Ann]
const total = isEligible.count(users);          // 2
```

<details>
<summary>Tree-shakable named imports &amp; operator constants (<code>mongory-js/op</code>)</summary>

```ts
import { compileMatcher, matchCondition, mongoryAnd, mongoryOr } from "mongory-js";
import { op } from "mongory-js/op";

const isAllowed = compileMatcher(
  mongoryAnd({ active: true }, mongoryOr({ role: "admin" }, { score: { [op.gte]: 90 } })),
);
const allowed = isAllowed.filter(records);
```

</details>

## Why Mongory? (and When Not to Use It)

- **Use Mongory when**: rules are stored as JSON (DB/config/feature flags/rule builder UIs), need identical evaluation in the browser AND backend Go/Python/Ruby/C services (`mongory-spec`), or need visual `traceTree()` debugging to explain why a record failed.
- **Don't use Mongory when**: your filter is a static `.filter((u) => u.age >= 18)` hardcoded in TS, or when you need MongoDB aggregation pipelines (`$group`, `$project`, `$lookup` — see `mingo`).
- **vs `sift` / `mingo`**: faster compiled matching (**1.5x–6.9x** vs `sift`, **2.6x–5.8x** vs `mingo`, **200x–350x** on large `$in`), built-in `explainTree()`/`traceTree()`, `maxDepth`/`maxNodes` safety budgets, `__proto__` guard, and cross-language spec parity.

## Benchmark Snapshot

Measured on Apple M3 (macOS arm64, Node `v23.1.0`, `10,000` records x 200 rounds; full monomorphic & polymorphic tables in [docs/performance.md](docs/performance.md)):

| Case (Monomorphic) | `plain_safe` | `mongory-js` | `sift` (`^17.1.4`) | `mingo` (`^7.2.7`) | vs `sift` / `mingo` |
|---|---:|---:|---:|---:|---:|
| `simple` | `19.1 ns` | `19.4 ns` | `29.5 ns` | `104.1 ns` | **1.5x / 5.4x faster** |
| `nested_and` | `40.5 ns` | `54.5 ns` | `367.7 ns` | `300.1 ns` | **6.7x / 5.5x faster** |
| `in_array_field` | `35.1 ns` | `36.7 ns` | `255.4 ns` | `212.5 ns` | **7.0x / 5.8x faster** |
| `large_in_500` | `34.4 ns` | `38.0 ns` | `13,429.8 ns` | `10,742.3 ns` | **353x / 282x faster** |

*(On Bun 1.3, `simple` runs in `7.8 ns/rec` and `large_in_500` in `16.1 ns/rec`. Against semantics-equivalent defensive Plain JS `plain_safe`, `mongory-js` stays within `1.01x–2.09x`.)*

## Debugging: `explain()`, `trace()`, `explainTree()` & `traceTree()`

Sibling conditions are automatically cost-sorted so cheap `$eq`/`$exists`/`$in` checks short-circuit before `$regex` or array scans:

```ts
import { mongory } from "mongory-js";

const matcher = mongory.compile({
  name: { $regex: "^A" },
  age: { $gte: 18 },
  active: true,
});

console.log(matcher.explain());

const { matched, trace } = matcher.trace({ name: "Bob", age: 15, active: false });
console.log(matched); // false
console.log(trace);

// Or retrieve JSON-safe structured AST & trace objects (for UI / devtools)
const planAst = matcher.explainTree();
const { tree } = matcher.traceTree({ name: "Bob", age: 15, active: false });
```

```text
[FAIL] And | value={"active": false, "age": 15, "name": "Bob"}
├── [FAIL] Field("active") | value=false
│   └── [FAIL] Eq(true) | value=false
└── [SKIP] 2 remaining branch(es) (short-circuited)
```

## Compile-Scoped Extensions & Safety Limits

Pass custom converters, virtual fields, custom operators, or safety limits per `compile` call with zero global mutable state:

```ts
import {
  mongory,
  withConverter,
  withField,
  withOperator,
  withOptions,
  withMaxDepth,
  withMaxNodes,
} from "mongory-js";

const domainOptions = withOptions(
  withConverter(ObjectId, (id) => id.toHexString()),
  withField<Order>("total", (o) => o.unitPrice.amount * o.qty),
  withOperator("$moneyGte", {
    matchElements: true,
    compile(target) {
      if (!(target instanceof Money)) throw new Error("$moneyGte requires Money");
      return (val, exists) =>
        exists && val instanceof Money && val.currency === target.currency && val.amount >= target.amount;
    },
  }),
  withMaxDepth(32),
  withMaxNodes(1024),
);

const orderMatcher = mongory.compile(
  { id: "65f1a2b3c4d5e6f708090a0b", unitPrice: { $moneyGte: new Money("USD", 50) }, total: { $gte: 100 } },
  domainOptions,
);
```

## Features, Operators & Differences from MongoDB

- **All 17 Mongory operators**: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$present`, `$and`, `$or`, `$not`, `$elemMatch`, `$every`, `$size`, `$regex` (`$options`: `i`, `m`, `s`).
- **Edge-case fidelity**: `null` vs `MISSING`, dot notation & escaped dots (`\.`), canonical array index keys (`"0"`, `"-1"` vs `"01"`), implicit `$elemMatch`, stateless `RegExp` cloning (`/g` & `/y` safe), exact `number` vs `bigint` comparisons without `2^53` precision loss, `Date` & `Uint8Array` support, O(1) bucketed `Set` lookup for `$in`/`$nin` (`>= 16` items).
- **Differences from MongoDB**: `$every` (returns `false` on `[]`) and `$present` are Mongory extensions; `$options` only permits `i`/`m`/`s`; unknown `$` keys fail compilation; aggregation (`$expr`), `$type`, `$mod`, geospatial, and update operators are not included. See [`mongory-spec` Differences from MongoDB](https://github.com/mongoryhq/mongory-spec#37-differences-from-mongodb-query-syntax).

## Development & Conformance

```bash
git clone https://github.com/mongoryhq/mongory-spec.git ../mongory-spec
npm install
npm test
npm run test:bun
npm run bench
```

## Security & Untrusted Input

- **Engine protections**: Pure in-memory evaluation (no SQL, no `$where`/`eval`), own-property lookups with `__proto__` guard, circular reference rejection (`MongoryInvalidConditionError`), and configurable `withMaxDepth` (default `64`) / `withMaxNodes` (default `4096`) limits.
- **Application responsibility**: When exposing queries to untrusted users, validate scalar types (preventing operator injection such as `{ $ne: null }`), allowlist queryable fields so sensitive properties cannot be probed, and restrict or bound untrusted `$regex` patterns (JS `RegExp` uses backtracking).

## License

MIT
