# 11: Price vs performance chart

**What to build:** a scatter plot of Average against price, so that a buyer can see the value frontier for their own pricing model.

**Blocked by:** 09 (model detail pages).

**Status:** ready-for-agent

- [ ] A scatter plot shows Average against input, output or blended price, selectable by the visitor.
- [ ] The blended-price ratio is a 3:1 input-to-output weighting with the divisor derived from the weight sum, stored as editable data rather than code.
- [ ] Models with null prices are excluded from the plot and listed separately below it as "Self-hosted / no public API rate".
- [ ] Primary scores drive the Average axis, and Coverage is available on hover or focus.
