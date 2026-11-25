# 03: Benchmark catalogue and dynamic columns

**What to build:** the full Benchmark catalogue drives the leaderboard, so that adding or changing a Benchmark never requires editing UI code.

**Blocked by:** 02 (safe data authoring loop).

**Status:** resolved

- [x] All 17 Benchmarks are present with category, description, metric, higherIsBetter, Tier, source URL, canonicalSources, limitations and evaluationSettingNotes.
- [x] The 12 core Benchmarks are selected by default and the 5 extended ones are not, derived directly from Tier.
- [x] Table columns, searchable fields and filters are generated from the Benchmark and Model data, with no hardcoded columns or Benchmark prose in the web app.
- [x] The best Score per Benchmark is highlighted from Primary scores only, and missing Scores display as "n/a" rather than zero.
- [x] Category values are constrained to the agreed nine-value enum.

## Answer

Resolved on the integration branch (merge commit `d36d1f6`, ticket branch `ticket/03-benchmark-catalogue-and-dynamic-columns`, implemented test-first via the tdd skill; 3 commits).

- All 17 Benchmarks present in `packages/data/benchmarks.json` (12 core + 5 extended) with category, description, metric, higherIsBetter, Tier, source URL, canonicalSources (with urlPatterns) and limitations/evaluationSettingNotes — transcribed from the researched catalogue notes; the five previously-UNVERIFIED saturation claims were re-verified live against provider model cards before being committed. Category values are constrained in `@llm-bench/schema` to the nine-value enum: knowledge, reasoning, math, coding, instruction-following, agentic, long-context, commonsense, robustness.
- Default selection derives directly from `tier === "core"`: 12 core selected, 5 extended unselected (`defaultSelectedBenchmarkIds` in the scoring package).
- Leaderboard columns, searchable fields (Model name, Provider) and filters (License strict three-value, Provider, Context window, price) are generated from the data package; no hardcoded columns, categories or Benchmark prose remain in `apps/web`. Sorting works on any column with missing Scores never treated as zero.
- Best Score per Benchmark is highlighted from Primary scores only; missing Scores render "n/a".
- Gates at merge: validate, lint, test (92 tests), build all PASS.
