# 06: Weights and shareable URL state

**What to build:** a visitor can weight Benchmarks and share the exact view, so that a ranking configuration is reproducible by someone else.

**Blocked by:** 05 (selection, Average, Coverage and ranking).

**Status:** resolved

- [x] Per-Benchmark weights change the computed value and the label switches to Weighted Average when any weight is non-default.
- [x] Benchmark selection, weights and compared Models are encoded in URL query parameters and decoded back into the same view.
- [x] Refreshing or opening a shared URL restores selection, weights, sorting and filters.
- [x] URL-state encode and decode are covered through the scoring package's public API.

## Answer

Resolved on the integration branch (merge commit `e3b4c2a`, ticket branch `ticket/06-weights-and-shareable-url-state`, implemented test-first via the tdd skill; 7 commits — the implementer's run was interrupted after committing, and the merger's gate run served as the final verification: validate, lint, test (84 tools tests), build and the Playwright browser check all PASS).

- Per-Benchmark weights live in the scoring package as pure functions: Weighted Average over Primary Scores, normalized by the sum of weights of the Benchmarks the Model actually covers (a missing Benchmark is not penalized); all-default weights reproduce the plain Average exactly; the displayed label switches to "Weighted Average" whenever any active weight is non-default, and ranking/tie-breaks/null-ordering run on the active aggregate. Real-data pin: Claude Sonnet 4.6 overtakes Opus 4.6 when SWE-bench Verified counts double.
- Benchmark selection, per-Benchmark weights, sorting, search and filters — plus a reserved compared-Models parameter — are encoded/decoded by `encodeLeaderboardUrlState`/`decodeLeaderboardUrlState` in `@llm-bench/scoring` (seam 1, round-trip and garbage-tolerance tested; unknown benchmark ids dropped, defaults win).
- The web app reads URL state on load and writes it on change: refreshing or opening a shared URL restores selection, weights, sorting and filters exactly (browser-verified, including a weight-0 exclusion case and the empty-selection n/a case).
