# 08: Benchmark detail pages

**What to build:** a routed page for every Benchmark explaining what it measures and where it is weak, so that researchers can cite results responsibly.

**Blocked by:** 03 (benchmark catalogue and dynamic columns).

**Status:** resolved

- [x] Each Benchmark has a directly addressable page reachable from the leaderboard.
- [x] The page shows the description, metric, limitations, saturation and contamination notes, and evaluationSettingNotes taken from data.
- [x] No Benchmark prose is hardcoded in the web app; adding a Benchmark creates its page automatically.
- [x] Direct navigation and refresh work on Benchmark routes, and keyboard navigation reaches all content.

## Answer

Resolved on the integration branch (merge commit `1b8519c`, ticket branch `ticket/08-benchmark-detail-pages`, implemented test-first via the tdd skill; 4 commits).

- Every Benchmark has a directly addressable page at `/benchmarks/:id`, reachable from the leaderboard via each Benchmark column header and each selection-list label. Client-side routing is a hand-rolled History-API router (no new dependency) with `/` as the leaderboard and a proper not-found view for unknown ids.
- Each page renders description, metric, limitations (saturation and contamination notes), evaluationSettingNotes, category, Tier, source link and the Canonical sources ordering as readable provenance rules — all from `@llm-bench/data`; no Benchmark prose or ids are hardcoded in `apps/web`, so adding a Benchmark creates its page automatically.
- Direct navigation and refresh work through three verified layers: explicit Vite SPA history fallback (dev + preview), the `vercel.json` catch-all rewrite (now pinned by a test), and a static server used by the test harness. Keyboard navigation reaches all content (real anchors, visible focus, focus moved to content after client-side navigation, back-to-leaderboard link as first tab stop).
- Gates at merge: validate, lint, test (96 tests), build all PASS; a separate Playwright browser check (`pnpm test:browser`, 60 checks, direct navigation + refresh on all 17 routes) also passes locally — CI wiring of that script is ticket 14 scope.
