# 14: Static deployment and full CI gates

**What to build:** a static site deployable to Vercel Hobby with deep links that work and all quality gates enforced, so that every merge is verifiable and hosting stays free.

**Blocked by:** 10 (compare view), 11 (price vs performance chart), 12 (CSV and JSON export), 13 (accessibility, responsiveness and performance).

**Status:** resolved

- [x] The built static output deploys from the repository root with no database, server functions or paid add-ons.
- [x] A catch-all SPA rewrite makes direct links and refreshes on Model, Benchmark and compare routes work.
- [x] CI requires validation, lint, tests and build on every pull request, with a frozen lockfile and pinned toolchain matching local and hosting environments.
- [x] Every package has a lint script and the shared ESLint flat config is applied.
- [x] The non-commercial hosting constraint is recorded and no analytics, ads or accounts are introduced.

## Answer

Resolved on the integration branch (merge commit `12dacb3`, ticket branch `ticket/14-static-deployment-and-full-ci-gates`, implemented test-first via the tdd skill; 5 commits).

- The built static output deploys from the repository root: `vercel.json` pins the full contract (install `pnpm install --frozen-lockfile`, build `pnpm --filter web build`, output `apps/web/dist`) with the catch-all SPA rewrite proven by tests to cover `/models/:id`, `/benchmarks/:id`, `/compare` and unknown paths; a static-only key allowlist and the absence of any `api/`/`functions/` directory are asserted — no serverless functions, no database, no paid add-ons.
- CI (`.github/workflows/ci.yml`) requires, on every pull request: frozen-lockfile install, then `pnpm validate`, `pnpm lint`, `pnpm test`, `pnpm build`, then the Playwright browser suite (Chromium installed, `PLAYWRIGHT_ENTRY` knob exported); toolchain pinned to pnpm 12.23.0 and Node 22, matching `packageManager`/`engines` and Vercel. The workflow's contract is itself pinned by tests (parsed with js-yaml: trigger, versions, step order, browser wiring) so drift is caught.
- Every package (root + 6) has a lint script through the shared ESLint flat config in `@llm-bench/config`; enforced by a test that expands the workspace globs, so new packages are audited automatically.
- The non-commercial hosting constraint (ADR-0004) is recorded in a new README alongside dev/CI/deployment docs and pointers to the glossary and ADRs. A no-analytics audit test proves the built JS ships zero network calls (no fetch/XMLHttpRequest/sendBeacon/WebSocket/Image to any origin; source URLs ship as links, not calls) and zero analytics/ad vendor identifiers; the one violation found (Vite's unreachable modulepreload polyfill) was removed.
- Gates at merge, from a clean state (all node_modules deleted, fresh frozen install): validate, lint, test (126 tests), build PASS; browser suite 356 checks + 11 perf checks green.
