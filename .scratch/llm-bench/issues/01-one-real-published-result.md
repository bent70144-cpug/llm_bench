# 01: One real Published Result on the leaderboard

**What to build:** a working pnpm workspace and the thinnest complete path from a real published Score to a rendered leaderboard row, so that the project proves its data-driven architecture with verifiable numbers rather than placeholders.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The workspace is scaffolded with pinned pnpm and Node versions, shared config, and all internal packages linked locally.
- [x] One real Model, one real Benchmark, and one verified Score with a Source type, source URL, publishedDate and retrievedDate are present, with no placeholder data.
- [x] The leaderboard renders that Model with Provider, License, Average and Coverage, and shows "n/a" for every Benchmark without a Score.
- [x] Average and Coverage are computed at read time by the scoring package; no aggregate is stored in the data package.
- [x] Validation, lint, tests and build all pass in CI from a frozen lockfile.

## Answer

Resolved on the integration branch (merge commit `d02938d`, ticket branch `ticket/01-one-real-published-result`, implemented test-first via the tdd skill).

- Full pnpm workspace scaffolded from the clean directory: `@llm-bench/config` (shared tsconfig + ESLint flat config), `@llm-bench/schema` (Zod schemas + inferred types), `@llm-bench/data` (JSON arrays only), `@llm-bench/scoring` (pure functions, Vitest), `web` (Vite + React), `tools` (`validate` command). pnpm pinned at 12.23.0 via `packageManager`, Node >= 22 via `engines`, workspace settings in `pnpm-workspace.yaml` (not `.npmrc`), lockfile committed, CI workflow gates validate/lint/test/build with a frozen lockfile.
- One real Published Result seeded with no placeholder data: Kimi K3.1 Pro (Moonshot AI, open-weights) — GPQA Diamond 94.2, Evaluation setting "Max reasoning effort (temperature 1.0, top-p 0.95)", Source type provider, source URL https://huggingface.co/moonshotai/Kimi-K3.1-Pro (publishedDate 2026-11-02, retrievedDate 2026-11-26, verified against the live model card). A second real Benchmark (MMLU-Pro) carries no Score, demonstrating "n/a" rendering and Coverage (1/2).
- Leaderboard renders the Model row with Provider, License + License name, Average and Coverage computed at read time by `@llm-bench/scoring`; nothing aggregated is stored in the data package.
- Gates at merge: `pnpm validate`, `pnpm lint`, `pnpm test` (24 tests), `pnpm build` all PASS; `pnpm install --frozen-lockfile` verified for CI parity.

