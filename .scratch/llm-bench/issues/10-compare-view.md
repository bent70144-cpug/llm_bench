# 10: Compare view

**What to build:** a side-by-side comparison of 2 to 4 Models with complementary charts, so that a buyer can choose between finalists.

**Blocked by:** 06 (weights and shareable URL state), 09 (model detail pages).

**Status:** resolved

- [x] A visitor can select 2 to 4 Models and see them side by side across all selected Benchmarks.
- [x] A radar chart plots only the visitor's selected Benchmarks, capped at 8 axes with a clear note when more are chosen, prioritizing Benchmarks with Scores across the compared Models.
- [x] A bar chart shows all selected Benchmarks, and missing values render as "n/a" instead of zero on both charts.
- [x] The compared Models are encoded in the URL, so a comparison can be shared and survives refresh.

## Answer

Resolved on the integration branch (merge commit `ec5062b`, ticket branch `ticket/10-compare-view`, implemented test-first via the tdd skill; 4 commits — a finisher agent completed the browser-check step the interrupted implementer left unwritten).

- A visitor can select 2–4 Models on the leaderboard (per-row checkboxes + a "Compare selected (n)" control enabling at 2) and see them side by side at `/compare` across all selected Benchmarks, with the active aggregate (Average or Weighted Average per ticket 06) and Coverage per Model; guard rails handle <2, >4 and unknown ids with friendly messages.
- The radar chart plots only the visitor's selected Benchmarks, capped at 8 axes (`RADAR_AXIS_CAP`), prioritizing Benchmarks with Primary Scores across the compared Models (`selectRadarBenchmarks` in the scoring package, seam-1 tested: coverage across compared Models desc, catalogue-order ties); a visible note names the deprioritized Benchmarks when more are selected. Missing values are never plotted as zero — staggered "n/a" labels + dashed segments.
- The bar chart shows all selected Benchmarks (reusing ticket 09's GroupedBarChart), missing values "n/a".
- Compared Model ids live in the URL `compare` parameter (carried by ticket 06's codec), so a comparison is shareable and survives refresh (browser-verified), together with selection and weights.
- Gates at merge: validate, lint, test (198 tests on branch), build PASS; browser check 314 checks green.
