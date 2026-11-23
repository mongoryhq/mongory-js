# mongory-js

**Zero-dependency TypeScript/JavaScript in-memory Mongo-style rule engine & query matcher** with built-in text (`explain()` / `trace()`) and structured AST (`explainTree()` / `traceTree()`) debugging — runs in browsers, Node.js (`>= 20`), Bun, Deno, and Edge runtimes.

**[Try the Interactive Playground & Visual Explain/Trace Debugger ↗](https://mongoryhq.github.io/mongory-central/)**

[![Mongory Playground & Visual Trace](https://mongoryhq.github.io/mongory-central/playground-trace.png)](https://mongoryhq.github.io/mongory-central/)

> **Zero database required:** Compile a filter condition once and evaluate plain objects, arrays, maps, or class instances with cost-sorted execution plans and short-circuit trace snapshots.  
> **Ecosystem:** [Interactive Playground](https://mongoryhq.github.io/mongory-central/) · [`mongory-go` (Go)](https://github.com/mongoryhq/mongory-go) · [`mongory-rb` (Ruby)](https://github.com/mongoryhq/mongory-rb) · [`mongory-core` (C99)](https://github.com/mongoryhq/mongory-core) · [`mongory-spec`](https://github.com/mongoryhq/mongory-spec)

## Features

- **Zero runtime dependencies** (ships ESM + CJS + `.d.ts`)
- **Collision-free TS exports**: use the `mongory` namespace (`import { mongory } from "mongory-js"` or default import) or tree-shakable named exports (`compileMatcher`, `matchCondition`, `mongoryAnd`, `mongoryOr`) without colliding with `drizzle-orm`, `lodash`, or native `Array` helpers
- **All 17 Mongory operators**: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$present`, `$and`, `$or`, `$not`, `$elemMatch`, `$every`, `$size`, `$regex` (with `$options`: `i`, `m`, `s`)
- **MongoDB & edge-case fidelity**: `null` vs missing key (`MISSING`), dot notation & escaped dots (`\.`), canonical array index lookup (`"0"`, `"-1"` vs `"01"`), implicit `$elemMatch`, stateless `RegExp` cloning (`/g` & `/y` safe), exact `number` vs `bigint` comparisons without `2^53` precision loss, `Date` & `Uint8Array` support, prototype pollution (`__proto__`) protection
- **Safety limits & DoS defense**: configurable `maxDepth` (default `64`) and `maxNodes` (default `4096`), circular reference rejection (`MongoryInvalidConditionError`), O(1) bucketed `Set` lookup for large `$in`/`$nin` lists (`>= 16` items)
- **Compile-scoped extensions** (no global singletons): `withOptions`, `withConverter`, `withField`, `withFieldResolver`, `withOperator`

## Installation

```bash
npm install mongory-js
# or: pnpm add mongory-js / yarn add mongory-js / bun add mongory-js
```

## Usage

Every example below is self-contained and runs top-to-bottom as written.

### 1. Basic Matching & Collection Helpers (`mongory` namespace)

Start with a dataset, evaluate one-off conditions with `mongory.match`, or compile a matcher once with `mongory.compile` and reuse its collection helpers (`match`, `filter`, `find`, `filterLimit`, `count`):

```ts
import { mongory } from "mongory-js";

const users = [
  { name: "Ann", age: 30, tags: ["ts", "go"], active: true },
  { name: "Bob", age: 15, tags: ["ruby"], active: true },
  { name: "Cid", age: 42, tags: ["ts", "c"], active: false },
];

// One-off evaluation
const isAdult = mongory.match({ age: { $gte: 18 } }, users[0]); // true

// Compile once, reuse across arrays/iterables
const isEligible = mongory.compile(
  mongory.and(
    { active: true },
    mongory.or({ tags: "ts" }, { age: { $lt: 18 } }),
  ),
);

const matched = users.filter(isEligible.match); // [Ann, Bob]
const first = users.find(isEligible.match); // Ann
const top1 = isEligible.filterLimit(users, 1); // [Ann]
const total = isEligible.count(users); // 2
```

### 2. Tree-Shakable Named Imports & Operator Constants (`mongory-js/op`)

Prefer direct function imports for minimal bundles, or import the optional `mongory-js/op` subpath for frozen operator key constants without typos:

```ts
import { compileMatcher, matchCondition, mongoryAnd, mongoryOr } from "mongory-js";
import { op } from "mongory-js/op";

const records = [
  { role: "admin", active: true, score: 92 },
  { role: "guest", active: true, score: 60 },
];

const isAllowed = compileMatcher(
  mongoryAnd({ active: true }, mongoryOr({ role: "admin" }, { score: { [op.gte]: 90 } })),
);

const allowed = isAllowed.filter(records); // [{ role: "admin", active: true, score: 92 }]
const quickCheck = matchCondition({ score: { [op.gte]: 80 } }, records[0]); // true
```

### 3. Debugging: `explain()` & `trace()` / `explainTree()` & `traceTree()`

Compile the matcher first, inspect the priority-sorted execution plan, then trace individual records to see why they pass, fail, or short-circuit:

```ts
import { mongory } from "mongory-js";

const matcher = mongory.compile({
  name: { $regex: "^A" },
  age: { $gte: 18 },
  active: true,
});

// 1) Inspect compiled plan sorted by evaluation priority (low cost first)
console.log(matcher.explain());

// 2) Trace an evaluation with human-readable PASS / FAIL / SKIP output
const { matched, trace } = matcher.trace({ name: "Bob", age: 15, active: false });
console.log(matched); // false
console.log(trace);

// 3) Or retrieve JSON-safe structured AST & trace objects (for UI / devtools)
const planAst = matcher.explainTree();
const { tree } = matcher.traceTree({ name: "Bob", age: 15, active: false });
// tree.children[0].status === "FAIL", children[1..2].status === "SKIP" (short-circuited)
```

`matcher.explain()` output:

```text
And
├── Field("active")
│   └── Eq(true)
├── Field("age")
│   └── Gte(18)
└── Field("name")
    └── Regex(/^A/)
```

`matcher.trace(...)` output:

```text
[FAIL] And | value={"active": false, "age": 15, "name": "Bob"}
├── [FAIL] Field("active") | value=false
│   └── [FAIL] Eq(true) | value=false
└── [SKIP] 2 remaining branch(es) (short-circuited)
```

- `explain()` / `explainTree()`: inspect compiled nodes ordered by cost/priority (`order` records execution position).
- `trace(record)` / `traceTree(record)`: capture per-node `PASS` / `FAIL` / `SKIP` status, array `element` / `skip` nodes, and bounded JSON-safe snapshots (handles `BigInt`, `NaN`, `±Infinity`, `-0`, cycles, and deep objects).

### 4. Compile-Scoped Extensions

Define domain types and custom options first, pass them to `mongory.compile(condition, options)`, and evaluate records without mutating any global registry:

```ts
import {
  mongory,
  withConverter,
  withField,
  withOperator,
  withOptions,
} from "mongory-js";

class ObjectId {
  constructor(private readonly hex: string) {}
  toHexString(): string {
    return this.hex;
  }
}

class Money {
  constructor(
    readonly currency: string,
    readonly amount: number,
  ) {}
}

interface Order {
  id: ObjectId;
  unitPrice: Money;
  qty: number;
}

const domainOptions = withOptions(
  withConverter(ObjectId, (id) => id.toHexString()),
  withField<Order>("total", (o) => o.unitPrice.amount * o.qty),
  withOperator("$moneyGte", {
    matchElements: true,
    compile(target) {
      if (!(target instanceof Money)) {
        throw new Error("$moneyGte requires Money");
      }
      return (val, exists) =>
        exists && val instanceof Money && val.currency === target.currency && val.amount >= target.amount;
    },
  }),
);

const orderMatcher = mongory.compile(
  {
    id: "65f1a2b3c4d5e6f708090a0b",
    unitPrice: { $moneyGte: new Money("USD", 50) },
    total: { $gte: 100 },
  },
  domainOptions,
);

const matched = orderMatcher.match({
  id: new ObjectId("65f1a2b3c4d5e6f708090a0b"),
  unitPrice: new Money("USD", 60),
  qty: 2,
}); // true
```

### 5. Safety Limits & Error Handling

Override `maxDepth` (`64`) or `maxNodes` (`4096`) per compile when handling untrusted query inputs:

```ts
import {
  MongoryLimitExceededError,
  compileMatcher,
  withMaxDepth,
  withMaxNodes,
} from "mongory-js";

try {
  compileMatcher(
    { a: { b: { c: 1 } } },
    withMaxDepth(2),
    withMaxNodes(100),
  );
} catch (err) {
  if (err instanceof MongoryLimitExceededError) {
    // Also an instance of MongoryInvalidConditionError & MongoryError
    console.error("Query exceeded configured limits:", err.message);
  }
}
```

## Development & Conformance

Behavior is verified against the cross-language [mongory-spec](https://github.com/mongoryhq/mongory-spec) fixtures (expected in `../mongory-spec` or via `MONGORY_SPEC_DIR`):

```bash
git clone https://github.com/mongoryhq/mongory-spec.git ../mongory-spec
npm install
npm test
npm run test:bun
npm run bench
```

See [docs/performance.md](docs/performance.md) for full Node.js benchmark results (`plain_fast`, semantics-equivalent `plain_safe`, `mongory-js`, `sift`, and `mingo` across monomorphic and polymorphic 10,000-record datasets).

## Comparison with `sift` / `mingo`

| Capability | `mongory-js` | `sift` / `mingo` |
|------------|--------------|------------------|
| **Cross-language parity** | Verified against shared `mongory-spec` across JS, Go, Ruby, and C99 | JS/TS-only |
| **Explain & Trace debugging** | Built-in `explain()`, `trace()`, `explainTree()`, `traceTree()` with short-circuit `[SKIP]` traces | Not built in |
| **Pre-compiled throughput** | Faster than both in our [benchmark suite](docs/performance.md): **1.5x–6.9x** vs `sift` and **2.6x–5.8x** vs `mingo` on standard queries; **200x–350x** on 500-item `$in` (Node `v23.1.0`, Apple M3, 10k mono & poly records); **1.01x–2.09x** vs semantics-equivalent defensive Plain JS | Slower per-record evaluation; linear scan on large `$in` |
| **Runtime dependencies** | `0` (ESM + CJS + `.d.ts`) | `0` |
| **Rule-engine safety & extras** | `$every`, `$present`, `maxDepth`/`maxNodes`, cycle rejection, `__proto__` guard | Focuses on MongoDB query/aggregation parity |

## Differences from MongoDB

- **`$every` (Mongory extension)**: Requires all array elements to match and returns `false` on empty arrays `[]` (no vacuous truth).
- **`$present` (Mongory extension)**: ActiveSupport-style presence check (`false` for missing key, `null`, `false`, `""`, `[]`, `{}`; `true` for numbers including `0` and non-empty strings/arrays/objects).
- **`$regex` / `$options`**: Restricted to the cross-engine regex subset with flags `i`, `m`, `s` (`x` and `u` are rejected).
- **Excluded operators**: Unknown `$`-prefixed keys fail compilation; aggregation (`$expr`), `$type`, `$mod`, geospatial, and update operators are not included.
- Full specification: [`mongory-spec` Differences from MongoDB](https://github.com/mongoryhq/mongory-spec#37-differences-from-mongodb-query-syntax).

## Security & Untrusted Input

- **Engine protections**: Pure in-memory evaluation (no SQL, no `$where`/`eval`), own-property lookups with `__proto__` guard, circular reference rejection, and configurable `withMaxDepth` (default `64`) / `withMaxNodes` (default `4096`) limits.
- **Application responsibility**: When exposing queries to untrusted users, validate scalar types (preventing operator injection such as `{ $ne: null }`), allowlist queryable fields so sensitive properties cannot be probed, and restrict or bound untrusted `$regex` patterns (JS `RegExp` uses backtracking).

## License

MIT
