# Performance & Benchmarks

## Reproducible Benchmarks

Run the benchmark script in `mongory-js`:

```bash
npm run bench
```

Each case compares:
- **`plain_fast`**: Hand-written JS assuming a static schema (no `Object.hasOwn`, no non-plain-container guards, no implicit array matching).
- **`plain_safe`**: Semantics-equivalent defensive Plain JS performing `Object.hasOwn`, prototype/container checks, and Mongo-style implicit array matching.
- **`mongory-js`**: Compiled matcher (`matcher.count(records)`).
- **`sift`** (`^17.1.4`) and **`mingo`** (`^7.2.7`): Peer dynamic Mongo-query libraries in JS.

### Monomorphic Dataset (Apple M3, macOS arm64, Node `v23.1.0`, 10,000 uniform records x 200 rounds)

| Case | `plain_fast` | `plain_safe` | `mongory-js` | `sift` | `mingo` | `mongory / plain_safe` |
|---|---:|---:|---:|---:|---:|---:|
| `simple` | `1.5 ns/rec` | `19.1 ns/rec` | `19.4 ns/rec` | `29.5 ns/rec` | `104.1 ns/rec` | `1.01x` |
| `or` | `4.7 ns/rec` | `24.9 ns/rec` | `43.3 ns/rec` | `78.7 ns/rec` | `140.7 ns/rec` | `1.74x` |
| `nested_and` | `5.4 ns/rec` | `40.5 ns/rec` | `54.5 ns/rec` | `367.7 ns/rec` | `300.1 ns/rec` | `1.35x` |
| `in_array_field` | `7.4 ns/rec` | `35.1 ns/rec` | `36.7 ns/rec` | `255.4 ns/rec` | `212.5 ns/rec` | `1.05x` |
| `large_in_500` | `15.2 ns/rec` | `34.4 ns/rec` | `38.0 ns/rec` | `13429.8 ns/rec` | `10742.3 ns/rec` | `1.10x` |
| `regex` | `12.0 ns/rec` | `33.7 ns/rec` | `41.8 ns/rec` | `63.1 ns/rec` | `177.0 ns/rec` | `1.24x` |

### Polymorphic Dataset (10,000 heterogeneous records x 200 rounds: varied hidden classes, missing keys, scalar/array mix)

| Case | `plain_fast` | `plain_safe` | `mongory-js` | `sift` | `mingo` | `mongory / plain_safe` |
|---|---:|---:|---:|---:|---:|---:|
| `simple` | `8.9 ns/rec` | `23.8 ns/rec` | `34.0 ns/rec` | `76.0 ns/rec` | `126.6 ns/rec` | `1.43x` |
| `or` | `10.9 ns/rec` | `34.5 ns/rec` | `72.0 ns/rec` | `146.3 ns/rec` | `184.1 ns/rec` | `2.09x` |
| `nested_and` | `9.3 ns/rec` | `32.1 ns/rec` | `45.9 ns/rec` | `293.0 ns/rec` | `250.1 ns/rec` | `1.43x` |
| `in_array_field` | `9.7 ns/rec` | `38.1 ns/rec` | `41.5 ns/rec` | `228.6 ns/rec` | `227.9 ns/rec` | `1.09x` |
| `large_in_500` | `24.8 ns/rec` | `46.0 ns/rec` | `52.8 ns/rec` | `13470.1 ns/rec` | `10750.6 ns/rec` | `1.15x` |
| `regex` | `19.8 ns/rec` | `42.5 ns/rec` | `48.0 ns/rec` | `70.0 ns/rec` | `182.9 ns/rec` | `1.13x` |

### Key Takeaways

- **Why `plain_fast` looks ~10x faster on monomorphic data**: V8 TurboFan inlines static property access on uniform hidden classes down to `1.5 ns/rec`, skipping `Object.hasOwn`, non-plain-object guards, and array element expansion. On polymorphic records, `plain_fast` slows down ~6x (`1.5 -> 8.9 ns/rec`).
- **Same-semantics comparison (`plain_safe`)**: Once hand-written JS performs equivalent safety and Mongo-style array checks, `mongory-js` stays within **1.01x-1.74x** (monomorphic) and **1.09x-2.09x** (polymorphic).
- **Peer JS libraries (`sift`, `mingo`)**: `mongory-js` is **1.5x-6.9x faster** than `sift` and **2.6x-5.8x faster** than `mingo` on standard queries, and **200x-350x faster** on `large_in_500` thanks to compiled `Set` lookups.

> For cross-language benchmarks, see [Mongory Central](https://mongoryhq.github.io/mongory-central/#benchmarks).
