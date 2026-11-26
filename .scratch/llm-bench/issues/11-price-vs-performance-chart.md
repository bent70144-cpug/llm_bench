# 11: Price vs performance chart

**What to build:** a scatter plot of Average against price, so that a buyer can see the value frontier for their own pricing model.

**Blocked by:** 09 (model detail pages).

**Status:** resolved

- [x] A scatter plot shows Average against input, output or blended price, selectable by the visitor.
- [x] The blended-price ratio is a 3:1 input-to-output weighting with the divisor derived from the weight sum, stored as editable data rather than code.
- [x] Models with null prices are excluded from the plot and listed separately below it as "Self-hosted / no public API rate".
- [x] Primary scores drive the Average axis, and Coverage is available on hover or focus.

## Answer

Resolved on the integration branch (merge commit `d74747e` after a clean re-sync over ticket 10, ticket branch `ticket/11-price-vs-performance-chart`, implemented test-first via the tdd skill; 3 commits, audited and gated by a finisher agent after an interrupted run).

- A scatter section on the leaderboard plots each Model's active aggregate (Average, or Weighted Average when weights are active, via `activeAggregateResult`) against input, output, or blended price, selectable by the visitor through a radio group.
- The blended price is computed by `blendedPricePer1M(model, pricingConfig)` in the scoring package: (3 × input + 1 × output) / 4 with the weights and divisor-from-weight-sum read from `packages/data/pricing-config.json` — stored as editable data, never hardcoded (unit tests prove changing the config changes the result).
- Null-priced Models (e.g. llama-4-maverick, deepseek-v4-pro) are excluded from the plot and listed separately below the chart under the exact heading "Self-hosted / no public API rate" with their aggregates and Coverage; priced Models without an aggregate on a narrow selection are named in a note rather than dropped.
- Primary scores drive the aggregate axis by construction; Coverage is shown on hover and keyboard focus (portal tooltip + aria-labels).
- Gates at merge: validate, lint, test (197 tests on branch), build PASS; browser check 302 checks green; perf checks within budgets.
