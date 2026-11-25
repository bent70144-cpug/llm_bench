# 04: Real Published Results for 20+ Models

**What to build:** a leaderboard seeded with real, verified published results for both proprietary and open-weight Models, so that visitors see defensible current numbers rather than fabricated ones.

**Blocked by:** 03 (benchmark catalogue and dynamic columns).

**Status:** resolved

- [x] At least 20 Models are present, each with a verified public Score in the core set and complete required metadata.
- [x] Every Score has an Evaluation setting, Source type, source URL, publishedDate, retrievedDate and verified status, and at least one Primary Score exists per Model and Benchmark pair that has Scores.
- [x] Competing published numbers resolve through each Benchmark's canonicalSources, with ties broken by newest publishedDate.
- [x] New model checkpoints are separate Models rather than overwrites, and corrections to the same checkpoint are traceable in version history.
- [x] The data package contains no placeholder or estimated Score, and validation and the browser suite both pass.

## Answer

Resolved on the integration branch (merge commit `da62c26`, ticket branch `ticket/04-real-published-results`; data converted by four parallel fragment agents from the verified research notes, then applied, tested and gated by one implementer).

- 26 Models present (9 proprietary + 17 open-weight/open-source incl. the pre-existing kimi-k3-1-pro), each with at least one verified public Score in the core set and complete required metadata; 107 Scores total — 87 Primary + 20 alternate Evaluation settings — across 87 (Model, Benchmark) pairs with exactly one Primary each.
- Every Score carries an Evaluation setting (41-entry controlled vocabulary, extended by data PR), Source type, source URL, publishedDate, retrievedDate and verified status; all values come from sources opened and confirmed on 2026-11-26; no placeholder, estimated or dummy data (pinned by a zero-placeholder test).
- Competing published numbers resolved through each Benchmark's Canonical sources with ties broken by newest publishedDate; the two same-rank same-date tau2-bench ties (claude-opus-4-6, claude-sonnet-4-6) were resolved by the documented Retail-domain tie-break after the official leaderboard was checked live and found to carry no Overall rows for those Models — resolution by rule, never by value (pinned in tests, e.g. the swebench-verified case where the eligible leaderboard 74.4 is Primary over a higher provider 80.9).
- New checkpoints are separate Models (kimi-k2-5 / kimi-k3 / kimi-k3-1-pro etc.); corrections replace in place with history in version control (commit a4a8f95).
- Exclusion documented: grok-4-7 and grok-4-6 publish no core-set Scores (only ARC-AGI-2), so they fall below the inclusion bar and are not entered.
- Gates at merge: validate, lint, test (75 tests incl. 6 new dataset-contract tests), build all PASS; the Playwright browser check also passes with 26 rendered rows.
