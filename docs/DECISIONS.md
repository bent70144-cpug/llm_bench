# Decisions record

Status: **documented only**. No code, no remote, no data, and no commits have been created. Building awaits an explicit go-ahead.

## Product scope

- Published results only: official model cards, papers, and public leaderboards. No self-run evaluations, no estimates. `evaluationSetting` and `sourceType` labels preserve comparability.
- Both proprietary and open-weight/open-source models. Inclusion bar: at least one verified public score in the core set plus complete required metadata.
- 17 benchmarks: 12 core + 5 extended, all on a 0–100 percent scale, all higher-is-better.
- Complete final build: leaderboard, benchmark pages, model detail pages, compare view, price/performance chart, CSV/JSON export, and CRUD tooling.
- Permanent non-goals: self-run pipelines, user accounts, comments, paid tiers, backend databases/serverless functions, crowdsourced Elo voting, speed and latency.

## Data model

- `Model`: `id`, `name`, `provider`, `license` (proprietary/open-weights/open-source), `licenseName?`, `releaseDate`, `contextWindow`, `inputPricePer1M?`, `outputPricePer1M?`, `referenceInferenceProvider?`, `lastUpdated`, `sourceUrl`, `notes?`.
- Prices are either both non-null or both null. `referenceInferenceProvider` is null for first-party rates and self-hosted models, and is populated only when a third-party host supplies the rate.
- `Benchmark`: `id`, `name`, `category` (nine-value enum), `description`, `metric`, `higherIsBetter` (true in v1), `tier` (core/extended), `sourceUrl`, `canonicalSources`, `limitations`, `evaluationSettingNotes`.
- `Score`: `modelId`, `benchmarkId`, `value` (0–100), `evaluationSetting`, `sourceType` (provider/paper/leaderboard/third-party), `sourceUrl`, `publishedDate`, `retrievedDate`, `verified`, `isPrimary`.
- Multiple scores per `(modelId, benchmarkId)` are allowed, differentiated by `evaluationSetting`; exactly one must be primary. Average, highlighting, and charts use primary rows only; alternate settings appear on model detail pages.
- `publishedDate <= retrievedDate`. A newer published score from an eligible source replaces the entry in place; history lives in Git. A new checkpoint is a new `modelId`.
- `canonicalSources` is an ordered list of `{ sourceType, urlPatterns? }`; highest-ranked eligible source wins, ties break by newest `publishedDate`. Validation requires each primary score to match an eligible `sourceType` and, where patterns exist, at least one `urlPattern`.
- `evaluationSetting` is a string constrained by `packages/data/evaluation-settings.json`; adding a setting is a data PR, not a schema PR.
- `verified: true` means the data owner checked the value and evaluation setting against the linked source URL — not independent reproduction. A UI tooltip says so.
- Blended price (3×input + 1×output, divisor from weight sum) is stored in `packages/data/pricing-config.json`. Null-priced models are excluded from the scatter and listed separately as "Self-hosted / no public API rate".

## Scoring and UX

- Only Average and Weighted Average; no official overall score. Always show coverage `(n/selected)`, badge models below 50% coverage, break equal-Average ties by higher coverage then name, and sort null-Average models last.
- Default selection derives from `tier === "core"` (12 checked, 5 unchecked). Sparse models remain ranked.
- Vite + client-side routing with an SPA rewrite in `vercel.json`; selection, weights, and compared models in URL query parameters.
- Compare: radar plots selected benchmarks, capped at 8 axes prioritizing benchmarks with scores across the compared models; bar chart shows all selected; missing values show as "n/a".
- Export defaults to the filtered, sorted view with selected benchmark columns, computed Average/coverage, and provenance fields; a separate button exports the full raw dataset including non-primary settings.
- Default `*.vercel.app` domain, no analytics initially. Analytics-dependent success metrics stay explicitly deferred until analytics launch.

## Tooling and process

- `pnpm@12.23.0`, Node >=22. Workspace settings such as `autoInstallPeers` live in `pnpm-workspace.yaml`, not `.npmrc` (pnpm 11+ restriction).
- ESLint flat config in `@llm-bench/config`, lint scripts in every package. CI gates: `pnpm validate`, `pnpm lint`, `pnpm test`, `pnpm build`.
- `manage-data.ts`, `import-scores.ts`, and `validate-data.ts` all ship in the initial build.
- Clean-build baseline: start from the directory containing the PRD, skills, and glossary; ignore `llm-bench.zip` entirely; author schema and `App.tsx` from scratch. The PRD's M0-prototype claim has been removed.
- No GitHub remote for now; hold real data entry and PRs until a repository URL is supplied.
- Pre-launch audit in `docs/pre-launch-audit.md`, signed off solely by the named data owner. Structural checks are automated in `pnpm validate`, leaving the human review for accuracy against live sources and zero placeholder data.
- v1 remains non-commercial to stay within Vercel Hobby terms (ADR-0004).

## Deliberately left unresolved

1. Accountable data owner's name and GitHub handle. The user explicitly chose to skip this and declined both a guessed name and a "TBD" placeholder. Consequently the PRD `Owner` field stays as-is, `.github/CODEOWNERS` is not written, and the pre-launch audit sign-off has no named signatory until the user supplies one. This was not assumed by the agent.

## Resolved after initial recording

- PRD milestones collapsed into a single Final Build / Launch milestone, with the discarded artifact and ZIP noted and only explicitly deferred post-launch items listed separately.
