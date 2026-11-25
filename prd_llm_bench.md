# PRD: LLM Bench

Status: Draft v0.4  
Owner: [Name]  
Last updated: November 25, 2026  
Team: [Product / Engineering / Data / Design]

## 1. Overview

LLM Bench is a public website that helps people compare large language models. It shows results from popular benchmarks side by side, calculates an overall average, and adds the practical details people need to choose a model: provider, license, context window, and price.

There is no prototype in the working directory: the only prior implementation is an external artifact and an unextracted ZIP, both using placeholder data, and neither is a baseline. This PRD defines the complete product to be built from a clean directory as a **pnpm monorepo**, seeded with the **latest publicly released, verified benchmark results** (no dummy data), and architected so every model, benchmark, score, and metadata field is **fully modifiable without editing UI code**.

## 2. Problem

Benchmark results are scattered across model announcements, papers, and separate leaderboards. Anyone choosing a model has to collect numbers by hand, and numbers from different sources are often not comparable. Price, speed, and context length live somewhere else again.

## 3. Goals

1. Give one trustworthy place to compare models across the most-cited benchmarks using **real, up-to-date public results**—never dummy or placeholder numbers.
2. Let users choose which benchmarks matter to them and see the average and ranking update immediately.
3. Show where every number came from and when it was last updated.
4. Keep all data fully decoupled and modifiable so a small team can add, edit, delete, or update models, benchmarks, scores, and metadata easily without touching application code.

## 4. Non-goals (v1)

- Crowdsourced head-to-head voting or Elo-style ranking (candidate for a later phase).
- Running our own evaluations on every model (v1 aggregates published results; see Open Questions).
- User accounts, comments, or paid tiers.
- Backend databases or serverless APIs (v1 is a static site).

## 5. Target users

| User | What they need |
| --- | --- |
| Developer choosing a model for a product | Quality per dollar, context window, license |
| ML researcher or analyst | Raw scores, sources, and methodology |
| Technical leader or buyer | A quick, defensible shortlist |
| Journalist or writer | Citable, up-to-date numbers |

## 6. User stories

- As a developer, I want to select only coding benchmarks so the average reflects my use case.
- As an analyst, I want to see the source and date for each score so I can verify it.
- As a buyer, I want to filter by license and sort by price to build a shortlist.
- As any visitor, I want the page to load fast, show real current benchmark data, and work on my phone.
- As a maintainer, I want to easily add, edit, delete, and manage models, benchmarks, scores, and model metadata without modifying hardcoded UI logic, with automated checks catching mistakes before merge.

## 7. Scope and requirements

### 7.1 Leaderboard (P0)

- Table of models with one column per benchmark, an Average column, and info columns: provider, license, context window, input price, output price (per 1M tokens).
- Sort by any column; search by model or provider; filter by license.
- Highlight the best score per benchmark.
- Show "n/a" for missing scores. Never treat a missing score as zero.

### 7.2 Benchmark selection and average (P0)

- Users toggle which benchmarks are included in the average.
- Average is the mean of the selected benchmarks that have a score for that model; the footer states how many benchmarks were used.
- Ranking recalculates instantly in the browser via `@llm-bench/scoring`.
- Initial benchmark set: MMLU-Pro, GPQA Diamond, MATH-500, HumanEval, SWE-bench Verified, IFEval. Final list to be confirmed (see Open Questions).

### 7.3 Data provenance (P0)

- Each score links to its source (paper, provider page, or our own run) with a retrieval date.
- Each benchmark has a short description page: what it measures, scoring method, known limitations.
- Scores from different evaluation settings (for example, number of shots, tool use) must be labeled, and not silently mixed.

### 7.4 Real public data and modifiability (P0)

- **Real, latest public results (no dummy data):** While building the project, fetch and populate the latest publicly released benchmark scores, pricing, context windows, and release dates from official provider announcements, model cards, papers, and public leaderboards. Placeholder or fabricated scores are strictly prohibited in production builds.
- **Zero hardcoding:** Never hardcode model lists, benchmark columns, categories, license filters, scores, or metadata inside `apps/web` or `@llm-bench/scoring`. All table columns, filters, cards, and charts must render dynamically from `@llm-bench/data`.
- **Full CRUD management:** Models, benchmarks, scores, and specific metadata fields (pricing, context length, notes, evaluation settings, source URLs) must be easily **added, edited, deleted, or bulk-updated** either directly in `packages/data/*.json` or through CLI helper scripts in `tools/`.
- **Safe deletion & referential integrity:** Deleting a model or benchmark must cleanly flag or cascade-remove orphaned score entries so broken references cannot reach production.

### 7.5 Model detail page (P1)

- Per-model page with all scores, price, context window, release date, and links.
- Small chart comparing the model against the leader on each benchmark.

### 7.6 Compare view (P1)

- Select 2 to 4 models and see them side by side, including a radar or bar chart.

### 7.7 Weighted average (P1)

- Users can weight benchmarks (for example, coding counts double) and share the configuration through a URL.

### 7.8 Price and performance chart (P2)

- Scatter plot of average score against price, to show the best value.

### 7.9 Data export and API (P2)

- CSV and JSON download of the full dataset (sourced directly from `@llm-bench/data`).

### 7.10 Non-functional requirements

- Page loads in under 2 seconds on a typical broadband connection; table stays responsive with 200+ models.
- Works on mobile; wide tables scroll inside their own container.
- Accessible: keyboard-operable controls, visible focus, sufficient contrast, light and dark themes.
- Data is stored as versioned JSON files in `packages/data`, strictly separated from UI code in `apps/web` and validated against `@llm-bench/schema` on every PR.

## 8. Data model

Schemas are defined and enforced with Zod in `@llm-bench/schema` and stored as editable JSON arrays in `@llm-bench/data`.

- **Model (`models.json`)**: `id`, `name`, `provider`, `license` (`proprietary` | `open-weights` | `open-source`), `releaseDate` (ISO date), `contextWindow`, `inputPricePer1M`, `outputPricePer1M`, `notes` (optional).
- **Benchmark (`benchmarks.json`)**: `id`, `name`, `category`, `description`, `metric`, `higherIsBetter` (boolean), `sourceUrl`.
- **Score (`scores.json`)**: `modelId`, `benchmarkId`, `value` (0–100), `evaluationSetting`, `sourceUrl`, `retrievedDate` (ISO date), `verified` (boolean).

Averages and rankings are computed at read time in the browser by `@llm-bench/scoring` and are never stored in data files. Adding a new field or optional attribute is handled centrally in `@llm-bench/schema`.

## 8A. Technical architecture (pnpm monorepo)

The site is a static web application in a pnpm workspace, with data, schema, scoring logic, and management tooling isolated into separate packages. It deploys to Vercel Hobby with no database and no server functions.

### Repository layout

```text
llm-bench/
├─ package.json            root scripts, packageManager pin (pnpm@12.23.0), engines (Node >=22)
├─ pnpm-workspace.yaml     workspace globs
├─ pnpm-lock.yaml          committed lockfile
├─ .npmrc                  pnpm peer dependency settings
├─ vercel.json             explicit install, build, and static output directory config
├─ apps/
│  └─ web/                 static site (Vite + React + TypeScript); 100% data-driven UI
├─ packages/
│  ├─ data/                models.json, benchmarks.json, scores.json (real public data)
│  ├─ schema/              TypeScript types + Zod validation (src/index.ts)
│  ├─ scoring/             averages, weighted averages, ranking, filtering (src/index.ts + Vitest tests)
│  └─ config/              shared tsconfig.base.json and ESLint rules
├─ tools/
│  ├─ validate-data.ts     validates JSON schemas, 0–100 bounds, and foreign-key integrity
│  ├─ manage-data.ts       CLI helper to add, edit, or delete models, benchmarks, and scores
│  └─ import-scores.ts     helper to bulk-import/update scores from CSV or public feeds
└─ .github/workflows/ci.yml
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools"
```

### Workspace packages

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@llm-bench/data` | Source of truth: real, verified JSON files only, no runtime code | none |
| `@llm-bench/schema` | Zod schemas and inferred TypeScript types for Model, Benchmark, Score | none |
| `@llm-bench/scoring` | Pure functions for average, weighted average, rank, sort, filter; fully unit-tested with Vitest | `@llm-bench/schema` |
| `@llm-bench/config` | Shared `tsconfig.base.json` and lint rules | none |
| `web` (app) | Static UI: dynamically renders leaderboard, filters, benchmark pages, model pages, compare view from `@llm-bench/data` | `@llm-bench/data`, `@llm-bench/schema`, `@llm-bench/scoring` |
| `tools` | Data validation (`validate-data.ts`), CRUD CLI (`manage-data.ts`), and bulk import (`import-scores.ts`) run locally and in CI | `@llm-bench/data`, `@llm-bench/schema` |

All internal links use `"workspace:*"` so pnpm resolves packages locally without publishing to a registry.

### Root scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `pnpm --filter web dev` | Run the site locally |
| `build` | `pnpm --filter web build` | Produce static output in `apps/web/dist` |
| `validate` | `pnpm --filter tools validate` | Fail on invalid schemas, out-of-range scores, or broken references |
| `data:manage` | `pnpm --filter tools manage` | Add, edit, or delete models, benchmarks, and scores with automatic validation |
| `data:import` | `pnpm --filter tools import` | Bulk-import or update scores from CSV/public sources |
| `test` | `pnpm -r test` | Run unit tests across all workspace packages |
| `lint` | `pnpm -r lint` | Lint every package |

### Data flow and CI pipeline

1. A maintainer updates data either by editing JSON files in `packages/data` directly or by running `pnpm data:manage` / `pnpm data:import`, then opens a pull request.
2. GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `pnpm validate`, `pnpm test`, and `pnpm build`.
3. Validation fails if any score is missing `sourceUrl` or `retrievedDate`, falls outside `0–100`, contains duplicate `(modelId, benchmarkId, evaluationSetting)` entries, or references an unknown/deleted `modelId` or `benchmarkId`.
4. After merge to `main`, Vercel builds `apps/web` and publishes the static bundle.
5. The browser loads the bundled JSON and `@llm-bench/scoring` computes averages and rankings dynamically—reflecting any added, edited, or deleted entries automatically.

### Vercel Hobby setup

- Deployed from the repository root using `vercel.json`:
  - Install command: `pnpm install --frozen-lockfile`
  - Build command: `pnpm --filter web build`
  - Output directory: `apps/web/dist`
- Pin `packageManager` (`pnpm@12.23.0`) and `engines` (`node >=22.0.0`) in root `package.json` so local, CI, and Vercel environments match.
- Static output only: no serverless functions, no database, no paid add-ons.
- Hobby is restricted to personal, non-commercial use; upgrade to Vercel Pro if the site adds ads, sponsorships, or company ownership (see Section 12).

### Architecture decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Package manager | pnpm workspaces | Fast installs, strict isolation, clean `workspace:*` links |
| Front-end | Vite + React + TypeScript | Minimal static bundle with zero server overhead; fully data-driven rendering |
| Data store | Editable JSON files in Git (`packages/data`) | Free, diff-reviewable, versioned, easily modified without touching code |
| Data management | Zod in `@llm-bench/schema` + `tools/` CLI (`manage-data.ts`, `validate-data.ts`) | Safe add/edit/delete operations with automatic schema and referential checks |
| Scoring logic | Separate pure package (`@llm-bench/scoring`) | Unit-tested independently of React; reusable if an API is added later |
| Upgrade path | Swap `@llm-bench/data` for a database/CMS/API behind the same `@llm-bench/schema` types | No rewrite of scoring logic or UI components required |

## 9. Methodology principles

- Always source the latest publicly released results from official model cards, research papers, or reputable public leaderboards; never ship dummy or estimated scores.
- Prefer provider-reported or independently reproduced scores; label which is which.
- Do not average benchmarks with different scales without normalizing. All initial benchmarks are percent scores (0 to 100).
- Document known issues: contamination, saturation, and differences in evaluation setup.
- Publish a changelog of data updates (derived from Git history on `packages/data`).

## 10. Success metrics

| Metric | Target (first 90 days after launch) |
| --- | --- |
| Weekly unique visitors | [TBD] |
| Share of sessions that change the benchmark selection or sort | [TBD] |
| Models with complete, verified data for core benchmarks | [TBD]% |
| Median age of scores shown | Under [TBD] days |
| Data errors reported and fixed within 7 days | [TBD]% |

## 11. Milestones

| Milestone | Deliverable |
| --- | --- |
| Final Build / Launch | Complete static site: sortable, searchable, filterable leaderboard with all 17 benchmarks (12 core + 5 extended), model detail pages, benchmark pages, compare view, price/performance scatter chart, CSV/JSON export, shareable Average/Weighted Average state, and full CRUD/validation tooling (`manage-data.ts`, `import-scores.ts`, `validate-data.ts`) with CI gates. Seeded with real, verified public data for 20+ models; zero dummy data and zero hardcoded UI entries. Deployed on Vercel Hobby. |

The earlier external prototype artifact and the `llm-bench.zip` baseline were discarded in favour of a clean build; there is no phased delivery plan.

**Post-launch (explicitly deferred):** custom domain purchase, cookieless analytics, any funded self-run evaluation pipeline, and any speed/latency measurement pipeline.

Date to be set by the team.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Published scores are not comparable | Label `evaluationSetting`; show `verified` flag; prefer one canonical source per benchmark |
| Data goes stale quickly | Defined update cadence, a named owner, easy CRUD/import tooling in `tools/`, and visible "last updated" dates |
| Malformed edits or orphaned deletes break the site | Enforce `pnpm validate` (Zod schema + foreign-key checks) and `pnpm build` as required CI checks before merge |
| Placeholder/dummy data accidentally ships | Require verified `sourceUrl` and `retrievedDate` on every score and enforce a pre-launch audit of `packages/data` |
| Benchmarks saturate or get contaminated | Add newer benchmarks dynamically via `packages/data` without UI changes; document limitations on each benchmark page |
| Providers dispute numbers | Public Git-based corrections process and direct source links |
| Licensing of benchmark data or logos | Review terms before launch; use plain text names |
| Exceeding Vercel Hobby non-commercial terms | Keep v1 non-commercial; budget for Vercel Pro (or migrate static `dist/` to Cloudflare Pages/GitHub Pages) if monetized or company-owned |

## 13. Open questions

1. Do we only aggregate published results, or run our own evaluations? If we run them, who pays for the compute?
2. Which benchmarks make the final core set, and who decides when to add or retire one?
3. How often do we update `packages/data`, and who owns it?
4. Do we include speed (tokens per second) and latency, which require our own measurements?
5. Which models are in scope for launch: closed, open weights, or both?
6. Do we name a single "overall score" or leave the average fully user-defined?
7. **Front-end framework for M3:** Stick with Vite + client-side routing (`apps/web`), or switch to Next.js static export for pre-rendered per-model pages?
8. Domain name and privacy-friendly analytics choices (hosting is decided: Vercel Hobby).