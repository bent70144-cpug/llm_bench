# LLM Bench

LLM Bench compares published language-model benchmark results. It is a
static site: every Model, Benchmark, and Score comes from real Published
Results stored as editable JSON in the `@llm-bench/data` package, and the
Average, Weighted Average, and Coverage you see are computed in the browser
at read time — never stored, never estimated, and never self-run.

The leaderboard ranks Models with Provider, License, Context window, and
price information beside every Score, each linked to its published source.
Benchmark pages document what each Benchmark measures and its limitations;
Model pages collect all of one Model's Scores with full provenance; the
compare view puts 2–4 Models side by side; and the price/performance chart,
CSV and JSON exports, and shareable URL state round out the toolkit.

## Repository layout

| Path | What lives there |
| --- | --- |
| `packages/data` | The source of truth: `models.json`, `benchmarks.json`, `scores.json`, `evaluation-settings.json`, `pricing-config.json` — real, verified Published Results only |
| `packages/schema` | Zod schemas and inferred TypeScript types for Model, Benchmark, and Score |
| `packages/scoring` | Pure functions: Average, Weighted Average, Coverage, ranking, filtering, URL state |
| `packages/config` | The shared `tsconfig.base.json` and the shared ESLint flat config |
| `apps/web` | The Vite + React static site; 100% data-driven, client-side routing |
| `tools` | `validate-data`, `manage-data`, and `import-scores` CLIs, plus the test suites |

## Development

Toolchain: **pnpm 12.23.0** and **Node >= 22** (pinned in the root
`package.json` so local, CI, and Vercel environments match).

```sh
pnpm install --frozen-lockfile   # install exactly the committed lockfile

pnpm dev                         # run the site locally (Vite dev server)
pnpm validate                    # validate the data package (schemas, bounds, references, invariants)
pnpm lint                        # lint every workspace package through the shared flat config
pnpm test                        # unit tests: scoring API, tools CLIs, built-site content
pnpm build                       # type-check and build the static site into apps/web/dist
pnpm test:browser                # browser suite: the built site in headless Chromium (browser + perf checks)

pnpm data:manage                 # add, edit, or delete Models, Benchmarks, and Scores (validates first)
pnpm data:import                 # bulk-import Scores from CSV
```

Adding data means editing JSON (directly or through the CLIs) — the UI has
no hardcoded Model lists, Benchmark columns, or scores, so no UI change is
ever needed for new data.

## CI

Every pull request (and every push to `main`) runs the full gate set in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): a frozen-lockfile
install, then `pnpm validate`, `pnpm lint`, `pnpm test`, `pnpm build`, and
the browser suite (`pnpm test:browser`, with Playwright's Chromium
installed by the workflow). Broken data or a broken build cannot merge.

## Deployment

The site deploys from the repository root to **Vercel Hobby** using
[`vercel.json`](vercel.json):

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --filter web build`
- Output directory: `apps/web/dist`
- A catch-all rewrite serves `index.html` for every path that matches no
  file, so deep links and refreshes on Model, Benchmark, and compare routes
  keep working (ADR-0003).

It is **static output only**: no database, no server functions, no paid
add-ons.

## Non-commercial constraint

Vercel Hobby hosting is restricted to personal, **non-commercial** use, and
v1 commits to staying inside those terms (see
[ADR-0004](docs/adr/0004-vercel-hobby-non-commercial.md)): no ads, no
sponsorships, no monetisation, **no analytics**, **no server functions**, no
accounts, and no comments. Upgrading hosting or adding analytics requires an
explicit decision — it is not a change to make casually.

## Documentation

- [`GLOSSARY.md`](GLOSSARY.md) — the controlled vocabulary for every term
  used in the data, UI, and docs (Average, Coverage, Score, Published
  Result, Source type, Primary score, Evaluation setting, Tier, …).
- [`docs/adr/`](docs/adr/) — the recorded architecture decisions:
  published-results-only sourcing (ADR-0001), Model as a checkpoint
  (ADR-0002), Vite SPA routing (ADR-0003), and the Vercel Hobby
  non-commercial constraint (ADR-0004).
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the consolidated decision
  record.
