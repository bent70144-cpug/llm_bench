# 14: Static deployment and full CI gates

**What to build:** a static site deployable to Vercel Hobby with deep links that work and all quality gates enforced, so that every merge is verifiable and hosting stays free.

**Blocked by:** 10 (compare view), 11 (price vs performance chart), 12 (CSV and JSON export), 13 (accessibility, responsiveness and performance).

**Status:** ready-for-agent

- [ ] The built static output deploys from the repository root with no database, server functions or paid add-ons.
- [ ] A catch-all SPA rewrite makes direct links and refreshes on Model, Benchmark and compare routes work.
- [ ] CI requires validation, lint, tests and build on every pull request, with a frozen lockfile and pinned toolchain matching local and hosting environments.
- [ ] Every package has a lint script and the shared ESLint flat config is applied.
- [ ] The non-commercial hosting constraint is recorded and no analytics, ads or accounts are introduced.
