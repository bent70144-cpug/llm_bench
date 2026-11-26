# 02: Safe data authoring loop

**What to build:** a maintainer can add, edit, delete and bulk-import Models, Benchmarks and Scores with automatic validation, and the same checks gate CI, so that no malformed or orphaned data can reach a build.

**Blocked by:** 01 (one real Published Result on the leaderboard).

**Status:** resolved

- [x] The schema package defines the complete Model, Benchmark and Score shapes from the spec, including the Evaluation setting vocabulary and blended-price ratio.
- [x] Validation rejects broken references, out-of-range values, duplicate Model/Benchmark/Evaluation setting triples, missing provenance dates, publishedDate after retrievedDate, more or fewer than one Primary score per pair, ineligible canonical sources, a false higherIsBetter, and inconsistent prices or Reference inference provider.
- [x] The CRUD command refuses a deletion that would orphan Scores unless an explicit cascade is requested.
- [x] The bulk-import command accepts CSV Scores and validates every row before writing.
- [x] Command-line tests assert exit codes and resulting data, and adding a Model through the CLI changes the rendered leaderboard after rebuild.

## Answer

Resolved on the integration branch (merge commit `af8dffd`, ticket branch `ticket/02-safe-data-authoring-loop`, implemented test-first via the tdd skill; 4 commits).

- `@llm-bench/schema` now covers the complete Model, Benchmark and Score shapes including the Evaluation setting vocabulary and blended-price ratio files; strict object schemas reject unknown fields.
- `pnpm validate` (tools/validate-data) rejects, with record-named messages: broken references, out-of-range values, duplicate (Model, Benchmark, Evaluation setting) triples, missing provenance dates, publishedDate after retrievedDate, more/fewer than one Primary score per pair, false higherIsBetter, Primary Scores ineligible under Canonical sources (including urlPattern mismatch), inconsistent prices or Reference inference provider, and Evaluation settings outside the vocabulary. Each rule is proven by a CLI-level test.
- `pnpm data:manage` (tools/manage-data): add/edit/delete for Models, Benchmarks and Scores; every mutation validates the full dataset in memory before writing; deletions that would orphan Scores are refused without an explicit `--cascade`.
- `pnpm data:import` (tools/import-scores): header-row CSV bulk import with RFC-4180 parsing, all-or-nothing validation, upsert semantics per the corrections-replace-in-place rule.
- CLI test suite: 68 tests total across the workspace (60 tools tests at the process seam asserting exit codes and written JSON). An end-to-end test proves adding a Model via the CLI changes the rendered leaderboard after rebuild, restoring the data files byte-for-byte afterwards.
- Gates at merge: validate, lint, test, build all PASS. Root `data:import` script uses `pnpm --filter tools run import` (bare `import` collides with a pnpm 12 built-in; documented in impl-02.md).
