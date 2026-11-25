# 03: Benchmark catalogue and dynamic columns

**What to build:** the full Benchmark catalogue drives the leaderboard, so that adding or changing a Benchmark never requires editing UI code.

**Blocked by:** 02 (safe data authoring loop).

**Status:** ready-for-agent

- [ ] All 17 Benchmarks are present with category, description, metric, higherIsBetter, Tier, source URL, canonicalSources, limitations and evaluationSettingNotes.
- [ ] The 12 core Benchmarks are selected by default and the 5 extended ones are not, derived directly from Tier.
- [ ] Table columns, searchable fields and filters are generated from the Benchmark and Model data, with no hardcoded columns or Benchmark prose in the web app.
- [ ] The best Score per Benchmark is highlighted from Primary scores only, and missing Scores display as "n/a" rather than zero.
- [ ] Category values are constrained to the agreed nine-value enum.
