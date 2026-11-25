# 09: Model detail pages

**What to build:** a routed page for every Model with all its Scores and practical details, so that a developer can evaluate one Model without cross-referencing other pages.

**Blocked by:** 07 (score provenance and alternate settings), 08 (benchmark detail pages).

**Status:** resolved

- [x] Each Model has a directly addressable page showing every Score, both prices, Context window, release date, Provider, License and License name, source links and notes.
- [x] The header shows the latest of the Model's metadata update date and its Scores' retrievedDate values.
- [x] Null prices read "self-hosted / no public API rate", and a Reference inference provider is named whenever a third party supplies the rate.
- [x] A chart compares the Model against the Benchmark leader on each Benchmark, using Primary scores and showing "n/a" for gaps.
- [x] Direct navigation and refresh work on Model routes, and all controls are keyboard-operable.

## Answer

Resolved on the integration branch (merge commit `04748f1` after a clean re-sync over tickets 05–08, ticket branch `ticket/09-model-detail-pages`, implemented test-first via the tdd skill; 7 commits).

- Every Model has a directly addressable page at `/models/:id` (all 26 real ids resolve; unknown ids get a "Model not found" view; leaderboard Model names link to it). Direct navigation and refresh are pinned by route tests and browser checks.
- The page shows every Score via ticket 07's `ScorePairDetail` (Primary score + Alternate Evaluation settings with full provenance, per Benchmark), both prices, Context window, release date, Provider, License and License name, source links and notes. Null prices read exactly "self-hosted / no public API rate" (e.g. llama-4-maverick); a Reference inference provider is named whenever a third party supplies the rate ("rate from OpenRouter" for kimi-k2-5 / minimax-m2-5).
- The header shows "Data current as of" the latest of the Model's lastUpdated and its Scores' retrievedDate values (`modelDataCurrency` in the scoring package, seam-1 tested; real-data pin 2026-11-26).
- A dependency-free pure-SVG chart compares the Model's Primary Score against the best value across Models on each of the 17 Benchmarks; missing values render "n/a", never a zero bar; each chart row carries a full aria-label.
- All controls keyboard-operable (first tab stop is the back-to-leaderboard link); gates at merge: validate, lint, test (143 tests on branch; merged suite 89/89 green), build PASS; Playwright browser check 146 checks green on branch, all green post-merge.
