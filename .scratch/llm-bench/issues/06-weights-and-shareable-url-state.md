# 06: Weights and shareable URL state

**What to build:** a visitor can weight Benchmarks and share the exact view, so that a ranking configuration is reproducible by someone else.

**Blocked by:** 05 (selection, Average, Coverage and ranking).

**Status:** ready-for-agent

- [ ] Per-Benchmark weights change the computed value and the label switches to Weighted Average when any weight is non-default.
- [ ] Benchmark selection, weights and compared Models are encoded in URL query parameters and decoded back into the same view.
- [ ] Refreshing or opening a shared URL restores selection, weights, sorting and filters.
- [ ] URL-state encode and decode are covered through the scoring package's public API.
