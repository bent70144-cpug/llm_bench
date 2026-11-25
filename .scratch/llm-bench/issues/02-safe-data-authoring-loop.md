# 02: Safe data authoring loop

**What to build:** a maintainer can add, edit, delete and bulk-import Models, Benchmarks and Scores with automatic validation, and the same checks gate CI, so that no malformed or orphaned data can reach a build.

**Blocked by:** 01 (one real Published Result on the leaderboard).

**Status:** ready-for-agent

- [ ] The schema package defines the complete Model, Benchmark and Score shapes from the spec, including the Evaluation setting vocabulary and blended-price ratio.
- [ ] Validation rejects broken references, out-of-range values, duplicate Model/Benchmark/Evaluation setting triples, missing provenance dates, publishedDate after retrievedDate, more or fewer than one Primary score per pair, ineligible canonical sources, a false higherIsBetter, and inconsistent prices or Reference inference provider.
- [ ] The CRUD command refuses a deletion that would orphan Scores unless an explicit cascade is requested.
- [ ] The bulk-import command accepts CSV Scores and validates every row before writing.
- [ ] Command-line tests assert exit codes and resulting data, and adding a Model through the CLI changes the rendered leaderboard after rebuild.
