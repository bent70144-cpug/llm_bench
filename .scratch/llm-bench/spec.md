# Spec: LLM Bench clean build

Status: ready-for-agent

## Problem Statement

Choosing a language model currently means collecting numbers by hand from provider announcements, papers, and separate leaderboards, then finding price, licence, and context length somewhere else. The numbers that are available rarely say what evaluation setting produced them, where they came from, or when they were retrieved, so results from different settings get silently mixed and a model with one published score can look like a leader over a model measured across a full core set. The only prior implementation is an external artifact and an unextracted archive using placeholder data; neither is a usable baseline, and shipping either would put fabricated Scores in front of users. There is no single fast, trustworthy place to compare real published results with the practical details needed to choose.

## Solution

Build the product from a clean directory as a pnpm workspace static site. A data package holds only real, verified Published Results as editable JSON arrays for Model, Benchmark, Score, the Evaluation setting vocabulary, and the blended-price ratio. A schema package defines and validates those types; a pure scoring package computes Average, Weighted Average, Coverage, ranking, filtering, and shareable URL state; a tools package provides validation, CRUD, and bulk-import commands; the web app renders every table column, filter, card, and page dynamically from the data package. Published results only — no self-run evaluations, no estimates — with Source type, Evaluation setting, publishedDate, and retrievedDate on every Score. Users toggle Benchmarks, apply weights, share state by URL, inspect Model and Benchmark pages, compare 2–4 Models, explore price against performance, and export their view or the full raw dataset. CI gates validation, lint, tests, and build; static output deploys to Vercel Hobby with client-side routing.

## User Stories

1. As a developer choosing a model for a product, I want a single leaderboard of published Scores, so that I can compare models without gathering numbers by hand.
2. As a developer, I want Provider, License, License name, Context window, and prices beside each Score, so that I can judge fit and cost in one place.
3. As a developer, I want missing prices shown as "self-hosted / no public API rate" rather than $0, so that I don't mistake open-weight Models for free hosted ones.
4. As a developer, I want input and output prices either both present or both absent, so that I can trust the price columns.
5. As a developer, I want a Reference inference provider named when a third party supplies a rate, so that I know whose price I am reading.
6. As a buyer, I want a strictly three-value License filter, so that filter buckets don't fragment into variants.
7. As a buyer, I want exact license terms in License name, so that I can satisfy legal review without guessing.
8. As a developer, I want to sort by any column, so that I can find the cheapest or longest-context Model quickly.
9. As a developer, I want to search by Model or Provider name, so that I can jump to a specific Model.
10. As a buyer, I want to filter by Provider, price, and Context window, so that I can build a shortlist.
11. As an analyst, I want the best Score per Benchmark highlighted, so that I can see leaders at a glance.
12. As an analyst, I want missing Scores shown as "n/a", so that I never read a missing result as zero.
13. As an analyst, I want each Average displayed with its Coverage count, so that I can see how many selected Benchmarks it is based on.
14. As an analyst, I want Models with under 50% Coverage badged, so that I don't mistake sparse Models for fully measured leaders.
15. As an analyst, I want equal Averages broken by higher Coverage and then name, so that ranking is deterministic and defensible.
16. As an analyst, I want null-Average Models at the bottom, so that unscored Models don't appear as leaders.
17. As a visitor, I want all 12 core Benchmarks selected by default and the 5 extended ones off, so that the starting view matches the agreed core set.
18. As a developer, I want to toggle Benchmarks in and out of the Average, so that the ranking reflects my use case.
19. As a developer, I want custom per-Benchmark weights, so that coding Benchmarks can count double for me.
20. As a developer, I want the UI to say "Weighted Average" when weights are active, so that I can tell which number I am reading.
21. As a developer, I want my Benchmark selection, weights, and compared Models in URL query parameters, so that I can share a view.
22. As a developer, I want a page refresh to preserve my view, so that I don't lose configuration.
23. As a visitor, I want the footer to state how many Benchmarks were used, so that I can interpret the Average.
24. As an analyst, I want each Score linked to its source URL, so that I can verify it.
25. As an analyst, I want the Source type shown, so that I can distinguish provider claims from papers, leaderboards, and third-party reports.
26. As an analyst, I want publishedDate and retrievedDate shown separately, so that I can tell when a result was published from when we fetched it.
27. As an analyst, I want a tooltip explaining that verified means the data owner checked the value and Evaluation setting against the source, so that I don't assume independent reproduction.
28. As an analyst, I want alternate Evaluation settings on the Model detail page, so that I can see numbers excluded from the Average.
29. As an analyst, I want exactly one Primary score per Model and Benchmark, so that the Average and highlighting use a consistent number.
30. As a maintainer, I want canonicalSources defined per Benchmark, so that competing published numbers resolve by a documented rule.
31. As a maintainer, I want ties in canonicalSources broken by newest publishedDate, so that resolution is deterministic.
32. As an analyst, I want an Evaluation setting drawn from a controlled vocabulary, so that equivalent labels don't split into separate buckets.
33. As a researcher, I want a Benchmark page explaining what it measures, its metric, and its limitations, so that I can cite it responsibly.
34. As a researcher, I want evaluationSettingNotes on each Benchmark page, so that I know the conditions under which Scores were produced.
35. As a researcher, I want saturation and contamination limitations documented, so that I don't over-trust saturated Benchmarks.
36. As a developer, I want a Model detail page with all Scores, prices, Context window, release date, and provenance, so that I can evaluate one Model thoroughly.
37. As a developer, I want a chart comparing the Model against Benchmark leaders, so that I can see its relative strength.
38. As a buyer, I want the Model page header to show the latest of its metadata update and Score retrieval dates, so that I know how current the page is.
39. As a buyer, I want to compare 2–4 Models side by side, so that I can choose between finalists.
40. As a buyer, I want a radar chart of selected Benchmarks, so that I can see the shape of each Model's strengths.
41. As a buyer, I want the radar capped at 8 axes with a note when more are selected, so that the chart stays readable.
42. As a buyer, I want a bar chart of all selected Benchmarks, so that I can see every number.
43. As a buyer, I want missing values marked "n/a" on charts rather than plotted as zero, so that I don't misread gaps.
44. As a buyer, I want a price/performance scatter plot, so that I can find the value frontier.
45. As a buyer, I want to choose input, output, or blended price for the scatter, so that I can model my own usage.
46. As a buyer, I want the blended-price ratio stored as editable data, so that the methodology can change without a code release.
47. As a buyer, I want null-priced Models listed separately below the chart, so that self-hosted options aren't silently dropped.
48. As an analyst, I want to export the filtered, sorted table as CSV, so that I can do my own analysis.
49. As an analyst, I want the export to include selected Benchmark columns, Average, Coverage, and provenance fields, so that it is self-describing.
50. As an analyst, I want JSON export too, so that I can ingest the data programmatically.
51. As an analyst, I want a separate full-dataset export including non-primary Scores, so that I can audit alternate settings.
52. As a mobile visitor, I want the wide table to scroll inside its own container, so that the page layout doesn't break.
53. As a visitor on a slow connection, I want the page to load in under two seconds, so that I can get numbers quickly.
54. As a visitor with 200+ Models loaded, I want the table to stay responsive, so that the site scales.
55. As a keyboard user, I want all controls keyboard-operable, so that I can use the site without a mouse.
56. As a low-vision user, I want visible focus and sufficient contrast, so that I can navigate reliably.
57. As a user who prefers dark mode, I want light and dark themes, so that reading is comfortable.
58. As a maintainer, I want to add, edit, and delete Models, Benchmarks, and Scores through a CLI, so that data changes don't require UI code edits.
59. As a maintainer, I want bulk CSV import of Scores, so that I can onboard many results at once.
60. As a maintainer, I want the CLI to validate every change before writing, so that bad data can't be committed.
61. As a maintainer, I want deletions that would orphan Scores refused unless I explicitly cascade, so that references stay intact.
62. As a maintainer, I want clear validation error messages, so that I can fix mistakes quickly.
63. As a maintainer, I want a local validation command, so that I can catch errors before opening a PR.
64. As a reviewer, I want CI to run validation, lint, tests, and build on every PR, so that broken data can't merge.
65. As a maintainer, I want Zod schemas as the single source of truth, so that types and validation never drift.
66. As a maintainer, I want all table columns, filters, and Benchmark prose derived from data, so that adding a Benchmark needs no UI change.
67. As a maintainer, I want Averages and rankings computed at read time and never stored, so that selection changes update instantly and data stays clean.
68. As a maintainer, I want a static site with no database or server functions, so that hosting stays free and simple.
69. As a maintainer, I want deep links to Model, Benchmark, and compare pages to work on refresh, so that shared URLs don't 404.
70. As a maintainer, I want pinned pnpm and Node versions, so that local, CI, and hosting match.
71. As a maintainer, I want lint in every package, so that code quality is enforced uniformly.
72. As a maintainer, I want scoring logic in a pure package, so that it can be tested independently and reused later.
73. As a maintainer, I want a feasible upgrade path to a database or API behind the same types, so that architecture can evolve without rewriting UI or scoring.
74. As a data owner, I want a committed pre-launch audit checklist, so that no placeholder or unverified Score ships.
75. As a data owner, I want automated structural checks in validation, so that manual review can focus on accuracy against live sources.
76. As a maintainer, I want no placeholder data anywhere in the data package, so that production builds contain only real Published Results.
77. As a visitor, I want to see when data was last updated, so that I can judge freshness.
78. As a maintainer, I want the update log derived from version history, so that no separate changelog must be maintained.
79. As a site owner, I want the site to stay non-commercial, so that free hosting terms remain valid.
80. As a visitor, I want no accounts or comments, so that the site stays fast and simple.
81. As a visitor, I want no crowdsourced Elo voting, so that rankings come only from published Scores.
82. As a visitor, I want no speed or latency figures, so that I'm not misled by workload-dependent measurements.
83. As an analyst, I want the site to state its methodology principles, so that limitations are transparent.
84. As a maintainer, I want analytics-dependent success metrics explicitly deferred, so that we don't promise numbers we can't measure.
85. As a maintainer, I want the retired prototype artifact and archive ignored entirely, so that no stale implementation leaks into the build.
86. As a future maintainer reading the repo, I want the glossary and ADRs to explain canonical terms and constraints, so that I don't reintroduce contradicted decisions.
87. As a maintainer, I want Benchmark categories locked to an agreed enum, so that filters stay stable.
88. As a maintainer, I want a Tier field driving default selection, so that default state and taxonomy never drift.
89. As an analyst, I want every Score's Evaluation setting labelled, so that results from different settings aren't silently mixed.
90. As a buyer, I want both proprietary and open-weight Models included, so that I can consider all credible options.

## Implementation Decisions

- **Modules to build, from a clean directory**: `@llm-bench/schema` (Zod schemas and inferred types), `@llm-bench/data` (JSON arrays only, no runtime code), `@llm-bench/scoring` (pure functions, no React), `@llm-bench/config` (shared TypeScript and ESLint flat config), `web` (Vite + React data-driven UI and client-side routing), and `tools` (validate, manage, and import commands). The prior external artifact and archive are not a baseline and are ignored entirely.
- **Package interfaces**: the schema package exports the Zod schemas and inferred types for Model, Benchmark, and Score; the data package exports typed arrays for those three plus the Evaluation setting vocabulary and the blended-price ratio; the scoring package exports pure functions for Average, Weighted Average, Coverage, ranking and tie-breaks, filtering, best-Score selection, and URL-state encode/decode; the tools package exposes three commands consumable both locally and in CI.
- **Model shape**: stable id, name, Provider, License (a strict three-value enum), optional License name, release date, Context window, nullable input and output prices, nullable Reference inference provider, lastUpdated, source URL, and optional notes. A new checkpoint is a new Model; corrections to the same checkpoint replace the Score in place, with history in version control.
- **Price invariant**: prices are either both non-null or both null; Reference inference provider must be null when prices are null and is populated only when a third party supplies the rate. Null-priced Models are shown as "self-hosted / no public API rate" and excluded from the price chart.
- **Benchmark shape**: stable id, name, category from a nine-value enum, description, metric, `higherIsBetter` (true for all v1 Benchmarks), Tier (core or extended), source URL, canonicalSources, limitations, and evaluationSettingNotes. Tier drives default selection directly: 12 core selected, 5 extended unselected.
- **Score shape**: Model and Benchmark references, value in 0–100, Evaluation setting, Source type from a four-value enum, source URL, publishedDate, retrievedDate, verified, and isPrimary.
- **Primary score rule**: several Scores may exist per Model and Benchmark when Evaluation settings differ; exactly one must be Primary. Average, best-Score highlighting, and charts use Primary Scores only; alternate settings are shown on the Model detail page.
- **Source resolution**: canonicalSources is an ordered list of `{ sourceType, urlPatterns? }` per Benchmark; the highest-ranked eligible source wins and ties break by newest publishedDate. Validation requires every Primary Score to match an eligible Source type and, where patterns are given, at least one URL pattern.
- **Date semantics**: publishedDate is when the source published the number; retrievedDate is when we fetched it; validation rejects publishedDate after retrievedDate. The Model page header date is the latest of the Model's lastUpdated and its Scores' retrievedDate values.
- **Verified semantics**: `verified: true` means only that the data owner checked the value and Evaluation setting against the linked source URL, not independent reproduction; the UI says so in a tooltip. Source type carries the provenance claim separately.
- **Evaluation setting vocabulary**: a data-owned JSON vocabulary constrains the free-text Evaluation setting; adding a setting is a data PR, not a schema PR.
- **Blended price**: a 3:1 input-to-output ratio with the divisor derived from the weight sum, stored as editable data rather than code.
- **Scoring semantics**: no official overall score; only Average and Weighted Average, always shown with Coverage in the form `(n/selected)`. All Models stay ranked, including sparse ones; models below 50% Coverage are badged; equal Averages break by higher Coverage then alphabetical name; null-Average Models sort last. Missing Scores are "n/a", never zero.
- **Routing and URL state**: Vite with client-side routing and a catch-all SPA rewrite so direct links to Model, Benchmark, and compare pages work; Benchmark selection, weights, and compared Models are query parameters, making every view shareable. No SEO pre-rendering requirement.
- **UI rendering**: no hardcoded Model lists, Benchmark columns, categories, filters, scores, or Benchmark prose in the web app; everything derives from the data package. Charts: Model-vs-leaders on the detail page, radar of selected Benchmarks capped at 8 axes prioritizing Benchmarks with Scores across compared Models, bar chart of all selected Benchmarks, and a price scatter using input, output, or blended price. Missing values render as "n/a" on charts.
- **Export contract**: default CSV and JSON exports contain the current filtered, sorted view including selected Benchmark columns, computed Average and Coverage, and provenance fields; a separate full-dataset export includes the raw Models, Benchmarks, and all Scores, including non-primary settings.
- **Tooling and CI**: pinned pnpm and Node versions; workspace settings in the workspace manifest rather than npm config due to newer pnpm restrictions. CI installs with a frozen lockfile and requires validation, lint, tests, and build. ESLint flat config lives in the shared config package and every package has a lint script.
- **Deletion behaviour**: the CRUD CLI refuses deletions that would orphan Scores unless an explicit cascade option is given. This is a conservative default for the previously unsettled flag-versus-cascade choice.
- **Pre-launch gate**: a committed audit checklist is the final launch gate, signed by the accountable data owner; structural checks are automated in validation so the human review covers accuracy against live sources and zero placeholder data.
- **Hosting constraint**: static output on Vercel Hobby, strictly non-commercial, no server functions and no analytics at launch; upgrading hosting or adding analytics requires an explicit decision (see the recorded constraint ADR).
- **Upgrade path**: swapping the data package for a database, CMS, or API behind the same schema types should require no rewrite of scoring logic or UI components.

## Testing Decisions

- **What makes a good test**: it exercises the public interface of a module and asserts observable outputs only — returned numbers and orderings, CLI exit codes and resulting data, or rendered text and links — never internal helpers, private state, or the shape of implementation code.
- **Seam 1, scoring package public API**: one unit-test suite against exported functions. Covers Average and Weighted Average, Coverage counts, Primary-score-only selection, best-Score highlighting, sparse-model ranking, tie-breaks, null-Average ordering, license/provider/price filtering, and URL-state encode/decode. This is the highest seam for pure computation and the only place the logic exists.
- **Seam 2, tools command line**: invoke the validation, management, and import commands as processes with temporary fixture data; assert exit codes and written JSON. Covers schema conformance, foreign keys, unique `(Model, Benchmark, Evaluation setting)` triples, exactly-one-Primary rule, 0–100 bounds, date ordering, canonicalSources eligibility, the price and Reference inference provider invariant, higherIsBetter being true, the Evaluation setting vocabulary, and cascade/refusal behaviour on delete. The exit code is the contract CI actually depends on.
- **Seam 3, built static site**: run one browser suite against the built output served locally. Covers dynamic rendering from the data package, Tier-driven default selection, toggles and weights reflected in URL parameters, direct navigation to all three page types, "n/a" rendering, the Coverage badge, radar axis cap, comparison flow, exports, mobile table scroll, keyboard operation, and theme switching.
- **Prior art**: none. The clean-build decision discarded the prior artifact and archive, so their few unit tests are not a baseline to extend. The three seams are new by necessity and are the minimum distinct boundaries: pure computation, data-integrity tooling, and rendered UI.
- **Fixtures**: synthetic fixtures live only in tests and temporary directories; the data package never contains placeholder data.

## Out of Scope

- Self-run evaluations, estimated Scores, and any future evaluation pipeline unless separately funded and owned.
- Tokens per second, TTFT, inter-token latency, and end-to-end latency, which need live probing and a separate telemetry pipeline.
- User accounts, logins, comments, paid tiers, crowdsourced head-to-head voting, and Elo rankings.
- Backend databases, serverless APIs, and any server-side rendering or static pre-rendering of per-Model pages.
- Custom domain purchase, analytics, and analytics-dependent success metrics until post-launch.
- Adding a fourth License category or a lower-is-better Benchmark without an explicit schema or scoring change.
- Monetisation, ads, sponsorships, or company ownership that would breach Hobby hosting terms.
- Phased delivery milestones; this is one final build and launch.

## Further Notes

- The accountable data owner's name and GitHub handle were explicitly left unresolved by the user; the specification does not invent one. Ownership is needed before code owners protection can be written and before the pre-launch audit can be signed off.
- No GitHub remote has been attached; real data entry and pull requests are to wait until a repository URL is supplied.
- No code, schema, data, or commits are to be created until the user gives an explicit go-ahead to build.
- Vocabulary is governed by the root glossary: use Average, Weighted Average, Coverage, Score, Published Result, Model, Benchmark, Source type, Canonical sources, Primary score, Evaluation setting, Tier, Provider, Reference inference provider, License, and License name, and avoid the listed synonyms.
- Contradicting the recorded ADRs requires calling them out explicitly rather than silently overriding: published-results-only sourcing, Model as a checkpoint rather than a family, Vite SPA routing rather than Next.js static export, and the Vercel Hobby non-commercial constraint.
- The deletion semantics were not explicitly settled; this spec records a conservative refuse-by-default rule with an explicit cascade option and flags it for confirmation.
