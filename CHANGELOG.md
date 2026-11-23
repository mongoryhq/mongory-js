# Changelog

## 0.2.0 (2026-11-23)

### Added

- **`mongory-js/op` subpath export**: Added frozen `op` operator constants (`op.eq`, `op.ne`, `op.gt`, `op.gte`, `op.lt`, `op.lte`, `op.in`, `op.nin`, `op.exists`, `op.present`, `op.and`, `op.or`, `op.not`, `op.elemMatch`, `op.every`, `op.size`, `op.regex`, `op.options`) for typo-safe query construction.
- **Fuzz testing & Benchmarks**: Added deterministic randomized fuzz tests (`fuzz.test.mjs`) with CI smoke gate, `docs/performance.md`, and pre-compiled throughput benchmarks comparing against plain JS, `sift`, and `mingo`.
- **Conformance**: Pinned `mongory-spec v0.2.1` conformance fixtures.

## 0.1.1 (2026-11-18)

### Fixed

- Include lazily built `arrayRecord` matcher priority across all enclosing ancestors (`FieldNode`, composite nodes, `$not`, `$elemMatch`, `$every`, `$size`) and structured AST (`explainTree` / `traceTree`).
- Dynamically re-sort enclosing `AllOfNode` and `AnyOfNode` child matchers via copy-on-write snapshot replacement when lazy `arrayRecord` construction increases priority, so subsequent evaluations short-circuit on cheaper branches first.

## 0.1.0 (2026-11-18)

### Added

- Zero-dependency pure TypeScript Mongory query compiler and evaluator targeting ES2022 runtimes (browsers, Node.js >= 20, Bun, Deno, Edge) with dual ESM/CJS builds and TypeScript declarations.
- Full `mongory-spec v0.2.0` conformance across all 17 operators (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$present`, `$and`, `$or`, `$not`, `$elemMatch`, `$every`, `$size`, `$regex` + `$options`).
- Hybrid collision-free API: `mongory` namespace (plus `default` export) alongside tree-shakable named exports (`compileMatcher`, `matchCondition`, `mongoryAnd`, `mongoryOr`, `Matcher`, `MISSING`, error classes, and compile-scoped options).
- Compile-scoped extensibility (`withOptions`, `withConverter`, `withField`, `withFieldResolver`, `withOperator`, `withMaxDepth`, `withMaxNodes`) with no global singleton state.
- Human-readable debugging (`Matcher.explain()`, `Matcher.trace(record)`) and structured JSON-serializable AST/evaluation trees (`Matcher.explainTree()`, `Matcher.traceTree(record)`) for UI and devtools integration.
- Security and performance hardening: cyclic condition rejection, `maxDepth` (`64`) / `maxNodes` (`4096`) limits, `__proto__` guard, bucketed O(1) `$in`/`$nin` `Set` lookup (`>= 16` elements), and monomorphic hot-path scalar/order specialization.
