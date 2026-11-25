# 01: One real Published Result on the leaderboard

**What to build:** a working pnpm workspace and the thinnest complete path from a real published Score to a rendered leaderboard row, so that the project proves its data-driven architecture with verifiable numbers rather than placeholders.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The workspace is scaffolded with pinned pnpm and Node versions, shared config, and all internal packages linked locally.
- [ ] One real Model, one real Benchmark, and one verified Score with a Source type, source URL, publishedDate and retrievedDate are present, with no placeholder data.
- [ ] The leaderboard renders that Model with Provider, License, Average and Coverage, and shows "n/a" for every Benchmark without a Score.
- [ ] Average and Coverage are computed at read time by the scoring package; no aggregate is stored in the data package.
- [ ] Validation, lint, tests and build all pass in CI from a frozen lockfile.
