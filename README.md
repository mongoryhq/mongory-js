# mongory-js

Zero-dependency, pure TypeScript MongoDB-style in-memory query matcher for JavaScript, TypeScript, browsers, Node.js (`>= 20`), Bun, Deno, and Edge runtimes: compile a filter condition once into an immutable matcher and evaluate objects, arrays, or class instances with built-in text (`explain()` / `trace()`) and structured AST (`explainTree()` / `traceTree()`) debugging.

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

### 2. Tree-Shakable Named Imports (Optional)

Prefer direct function imports for minimal bundles without changing semantics:

```ts
import { compileMatcher, matchCondition, mongoryAnd, mongoryOr } from "mongory-js";

const records = [
  { role: "admin", active: true, score: 92 },
  { role: "guest", active: true, score: 60 },
];

const isAllowed = compileMatcher(
  mongoryAnd({ active: true }, mongoryOr({ role: "admin" }, { score: { $gte: 90 } })),
);

const allowed = isAllowed.filter(records); // [{ role: "admin", active: true, score: 92 }]
const quickCheck = matchCondition({ score: { $gte: 80 } }, records[0]); // true
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
```

## License

MIT
