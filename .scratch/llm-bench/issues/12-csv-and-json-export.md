# 12: CSV and JSON export

**What to build:** one-click export of both the current view and the whole dataset, so that analysts can take the numbers with their provenance intact.

**Blocked by:** 06 (weights and shareable URL state).

**Status:** resolved

- [x] The default CSV and JSON exports contain the currently filtered and sorted rows, selected Benchmark columns, computed Average and Coverage, and provenance fields.
- [x] A separate full-dataset export contains all raw Models, Benchmarks and Scores, including non-primary Evaluation settings.
- [x] Exports reflect the active Benchmark selection and weights, and contain no hardcoded columns.
- [x] Both export controls are keyboard-operable and labelled for assistive technology.

## Answer

Resolved on the integration branch (merge commit `5dbe755` after a clean re-sync over tickets 10 and 11, ticket branch `ticket/12-csv-and-json-export`, implemented test-first via the tdd skill; 8 commits, audited and gated by a finisher agent after an interrupted run).

- Default CSV and JSON exports snapshot the currently filtered and sorted rows: Model fields, one column per selected Benchmark (Primary score), companion provenance columns per Benchmark (Source type, source URL, publishedDate, retrievedDate), the computed aggregate labelled "Average" or "Weighted Average" per active weights, and Coverage (n/selected). RFC 4180 quoting (a comma or quote in a Model name cannot corrupt the file); missing scores export "n/a" consistently; JSON adds a self-describing metadata block (selection, weights, sort, filters, export date). Filenames are dated (`llm-bench-view-<date>.csv/.json`).
- A separate full-dataset export ships the raw Models, Benchmarks and ALL Scores including non-Primary alternate Evaluation settings as one JSON file (browser-pinned via Opus 4.6's tau²-bench Telecom 99.25 alternate).
- Exports derive entirely from the active selection and weights at click time — no hardcoded columns (e2e pins unselected extended-Tier Benchmarks absent, and a click-time weight flipping the aggregate label to Weighted Average).
- All three controls are native buttons with descriptive aria-labels, keyboard-operable (browser check drives the CSV download via focus + Enter and real Playwright download events).
- Gates at merge: validate, lint, test (200 tests on branch), build PASS; browser check 287 checks green.
