# Performance & Benchmarks

## Reproducible Benchmarks

Run the included benchmark script in `mongory-js`:

```bash
npm run bench
```

### Measured Results (Apple M3, macOS arm64, Node `v23.1.0`, 10,000 records x 200 rounds)

| Case | Condition | Speed | Per 10k Records |
|---|---|---|---|
| `simple` | `{ age: { $gte: 18 } }` | `18.7 ns/rec` | `0.187 ms` |
| `or` | `{ $or: [{ age: { $gte: 18 } }, { status: "active" }] }` | `43.0 ns/rec` | `0.430 ms` |
| `nested_and` | `{ "profile.city": "taipei", status: "active", age: { $lt: 40 } }` | `54.6 ns/rec` | `0.546 ms` |
| `in_array_field` | `{ tags: { $in: ["go", "rust"] } }` | `39.0 ns/rec` | `0.390 ms` |
| `large_in_500` | `{ name: { $in: [...500 items] } }` (`Set` lookup) | `41.9 ns/rec` | `0.419 ms` |
| `regex` | `{ name: { $regex: "^user[a-f]$" } }` | `39.7 ns/rec` | `0.397 ms` |

> For cross-language benchmarks (`mongory-core`, `mongory-go`, `mongory-rb`), see [Mongory Central](https://mongoryhq.github.io/mongory-central/#benchmarks).
