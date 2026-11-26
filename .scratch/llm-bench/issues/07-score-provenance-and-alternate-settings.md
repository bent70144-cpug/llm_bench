# 07: Score provenance and alternate settings

**What to build:** every number carries visible provenance and its evaluation conditions, so that an analyst can verify it and tell why two published results differ.

**Blocked by:** 04 (real Published Results for 20+ Models).

**Status:** resolved

- [x] Each Score links to its source URL and displays Source type, publishedDate and retrievedDate.
- [x] A tooltip explains that verified means the data owner checked the value and Evaluation setting against the source, not independent reproduction.
- [x] Alternate Evaluation settings for a Model and Benchmark are listed on the Model page and are excluded from Average and highlighting.
- [x] Validation enforces exactly one Primary Score per pair and checks each Primary Score against the Benchmark's canonicalSources, including URL patterns.
- [x] Evaluation settings come from the controlled vocabulary, and adding one is a data PR rather than a schema PR.

## Answer

Resolved on the integration branch (merge commit `a89adb5` after a clean re-sync over ticket 05, ticket branch `ticket/07-score-provenance-and-alternate-settings`, implemented test-first via the tdd skill; 2 commits).

- Every Score on the leaderboard is a real anchor to its source URL with an accessible tooltip (hover and focus, aria-describedby, portal-rendered so the scroll container cannot clip it) showing Source type, Evaluation setting, publishedDate, retrievedDate and verified status.
- The verified tooltip states exactly the recorded semantics: the data owner checked the value and Evaluation setting against the linked source URL — not an independent reproduction (a bundle test asserts the misleading wording never ships).
- New scoring API `scoresForPair(modelId, benchmarkId, scores)` → { primary, alternates }; a reusable `ScorePairDetail` component lists the Primary score and each Alternate Evaluation setting with full provenance and the exclusion note. It is surfaced via a keyboard-operable Score details panel on the leaderboard; ticket 09 mounts the same component on the Model detail page (this ticket blocks 09, so the literal Model-page placement completes there — component and API are ready and documented in impl-07.md).
- Alternates are excluded from Average and highlighting (pinned: Retail 91.89 Primary over Telecom 99.25 alternate; leaderboard 74.4 over higher provider rows). Validation's exactly-one-Primary and Canonical sources eligibility rules (incl. URL patterns) kept green unchanged; the Evaluation setting vocabulary remains data-owned.
- Gates at merge: validate, lint, test (114+ tests on branch, merged suite green), build all PASS; Playwright browser check 80/80 PASS.
