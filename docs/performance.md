# Performance & Benchmarks

## Reproducible Benchmarks

Run the benchmark script in `mongory-js`:

```bash
npm run bench
```

### Measured Results (Apple M3, macOS arm64, Node `v23.1.0`, 10,000 records x 200 rounds)

| Case | Condition | Plain JS | `mongory-js` | Overhead |
|---|---|---|---|---|
| `simple` | `{ age: { $gte: 18 } }` | `1.2 ns/rec` | `18.9 ns/rec` | `15.63x` |
| `or` | `{ $or: [{ age: { $gte: 18 } }, { status: "active" }] }` | `5.1 ns/rec` | `43.4 ns/rec` | `8.57x` |
| `nested_and` | `{ "profile.city": "taipei", status: "active", age: { $lt: 40 } }` | `5.8 ns/rec` | `55.4 ns/rec` | `9.56x` |
| `in_array_field` | `{ tags: { $in: ["go", "rust"] } }` | `6.7 ns/rec` | `36.0 ns/rec` | `5.39x` |
| `large_in_500` | `{ name: { $in: [...500 items] } }` (`Set` lookup) | `16.9 ns/rec` | `40.3 ns/rec` | `2.38x` |
| `regex` | `{ name: { $regex: "^user[a-f]$" } }` | `11.8 ns/rec` | `40.4 ns/rec` | `3.41x` |

> For cross-language benchmarks, see [Mongory Central](https://mongoryhq.github.io/mongory-central/#benchmarks).
