# mongory-js

Zero-dependency, pure TypeScript MongoDB-style in-memory query matcher for JavaScript, TypeScript, browsers, Node.js (`>= 20`), Bun, Deno, and Edge runtimes: compile a filter condition once into an immutable matcher and evaluate objects, arrays, or class instances with built-in `explain()` and `trace()` debugging.

## Features

- **Zero runtime dependencies** (ships ESM + CJS + `.d.ts`)
- **Collision-free TS exports**: use the `mongory` namespace (`import { mongory } from "mongory"` or default import) or tree-shakable named exports (`compileMatcher`, `matchCondition`, `mongoryAnd`, `mongoryOr`) without colliding with `drizzle-orm`, `lodash`, or native `Array` helpers
- **All 17 Mongory operators**: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$present`, `$and`, `$or`, `$not`, `$elemMatch`, `$every`, `$size`, `$regex` (with `$options`: `i`, `m`, `s`)
- **MongoDB & edge-case fidelity**: `null` vs missing key (`MISSING`), dot notation & escaped dots (`\.`), canonical array index lookup (`"0"`, `"-1"` vs `"01"`), implicit `$elemMatch`, stateless `RegExp` cloning (`/g` & `/y` safe), exact `number` vs `bigint` comparisons without `2^53` precision loss, `Date` & `Uint8Array` support, prototype pollution (`__proto__`) protection
- **Safety limits & DoS defense**: configurable `maxDepth` (default `64`) and `maxNodes` (default `4096`), circular reference rejection (`MongoryInvalidConditionError`), O(1) bucketed `Set` lookup for large `$in`/`$nin` lists (`>= 16` items)
- **Compile-scoped extensions** (no global singletons): `withOptions`, `withConverter`, `withField`, `withFieldResolver`, `withOperator`

## Quick Start

### Namespace style (recommended, mirrors Go `mongory.*`)

```ts
import { mongory } from "mongory";

const users = [
  { name: "Ann", age: 30, tags: ["ts", "go"], active: true },
  { name: "Bob", age: 15, tags: ["ruby"], active: true },
  { name: "Cid", age: 42, tags: ["ts", "c"], active: false },
];

const isEligible = mongory.compile(
  mongory.and(
    { active: true },
    mongory.or({ tags: "ts" }, { age: { $lt: 18 } }),
  ),
);

const matched = users.filter(isEligible.match); // [Ann, Bob]
const first = users.find(isEligible.match); // Ann
const top1 = isEligible.filterLimit(users, 1); // [Ann]
```

### Tree-shakable named imports

```ts
import { compileMatcher, matchCondition, mongoryAnd, mongoryOr } from "mongory";

const matcher = compileMatcher(
  mongoryAnd(
    { active: true },
    mongoryOr({ tags: "ts" }, { age: { $lt: 18 } }),
  ),
);
const ok = matchCondition({ age: { $gte: 18 } }, users[0]); // true
```

### Debugging with `explain()` and `trace()`

```ts
console.log(matcher.explain());

const { matched, trace } = matcher.trace({ name: "Bob", age: 15, active: false });
console.log(matched, trace);
```

```text
[FAIL] And | value={"active": false, "age": 15, "name": "Bob"}
├── [FAIL] Field("active") | value=false
│   └── [FAIL] Eq(true) | value=false
└── [SKIP] 1 remaining branch(es) (short-circuited)
```

### Compile-Scoped Extensions

```ts
import {
  mongory,
  withConverter,
  withField,
  withOperator,
  withOptions,
} from "mongory";

const domainOptions = withOptions(
  withConverter(ObjectId, (id) => id.toHexString()),
  withField<Order>("total", (o) => o.price * o.qty),
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

const m = mongory.compile({ price: { $moneyGte: new Money("USD", 100) } }, domainOptions);
```

## Conformance & Development

Behavior is verified against the cross-language [mongory-spec](https://github.com/mongoryhq/mongory-spec) fixtures:

```bash
npm install
npm test
MONGORY_SPEC_DIR=../mongory-spec npm run test:bun
```

## License

MIT
