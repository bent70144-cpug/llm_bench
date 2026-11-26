# 05: Selection, Average, Coverage and ranking

**What to build:** visitors can shape the leaderboard to their use case and read an honest ranking, so that sparse Models are not mistaken for fully measured leaders.

**Blocked by:** 04 (real Published Results for 20+ Models).

**Status:** resolved

- [x] Toggling Benchmarks recalculates Average instantly in the browser and updates the footer with the number of Benchmarks used.
- [x] Every Average is displayed with its Coverage count in the form (n/selected), and Models below 50% Coverage of the active selection carry a visible badge.
- [x] Equal Averages break by higher Coverage and then alphabetical Model name; null-Average Models sort to the bottom.
- [x] Sorting by any column, searching by Model or Provider, and filtering by License, Provider, price and Context window all work together.
- [x] Only Primary scores feed Averages, highlighting and ranking.

## Answer

Resolved on the integration branch (merge commit `3606270`, ticket branch `ticket/05-selection-average-coverage-and-ranking`, implemented test-first via the tdd skill; 5 commits).

- New scoring API (signatures added, none changed): `rankModelsByAverage` (Average desc, ties by higher Coverage then alphabetical name, null-Average Models last by name), `formatCoverage` ("(n/selected)"), `isUnderHalfCoverage` (strict under 50%; exactly-50% not badged). `sortModelsByColumn` applies the same chain for Average and Benchmark columns in both directions; missing values never sort as zero.
- Toggling a Benchmark recalculates Average instantly in the browser and the footer states the number of Benchmarks used; every Average displays with its Coverage; Models under 50% Coverage of the active selection carry a data-driven "Under 50% Coverage" badge (23/26 real Models badged on the default selection; the exactly-50% trio stays unbadged).
- Sorting by any column, search by Model or Provider, and filtering by License, Provider, price and Context window compose together (filter then search then rank), verified against expectations computed from the data package.
- Only Primary scores feed Averages, highlighting and ranking — pinned by tests (e.g. claude-opus-4-5 shows SWE-bench Verified 74.4, never its higher provider alternates).
- Gates at merge: validate, lint, test (120 tests), build all PASS; Playwright browser check 66/66 PASS.
