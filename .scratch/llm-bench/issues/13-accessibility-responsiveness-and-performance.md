# 13: Accessibility, responsiveness and performance

**What to build:** a site that works on a phone, with a keyboard, and at scale, so that every visitor can read the numbers quickly.

**Blocked by:** 05 (selection, Average, Coverage and ranking).

**Status:** resolved

- [x] The wide table scrolls inside its own container on mobile without breaking the page layout.
- [x] All controls are keyboard-operable with visible focus and sufficient contrast in both light and dark themes.
- [x] The leaderboard stays responsive with 200+ Models loaded.
- [x] A typical broadband page load completes in under two seconds.
- [x] Browser-level checks cover mobile scroll, theme switching and keyboard operation against the built output.

## Answer

Resolved on the integration branch (merge commit `92f13af` after a clean re-sync over ticket 09, ticket branch `ticket/13-accessibility-responsiveness-and-performance`, implemented test-first via the tdd skill; 7 commits — themes and mobile were committed by the first implementer run, completed by a continuation agent after a tool interruption).

- Light and dark themes with a keyboard-operable, state-announcing toggle; WCAG AA contrast verified by an automated audit across the leaderboard, Benchmark pages, Score details panel and tooltip in BOTH themes (40 contrast checks); `prefers-color-scheme` default with persistence across reloads and no flash-of-wrong-theme.
- The wide table scrolls inside its own container at 375px without breaking the page layout; Benchmark pages and the Score details panel stay usable at that width (browser-pinned).
- All controls keyboard-operable with visible focus in both themes; skip-to-content link added (first tab stop), tab order audited, no keyboard traps.
- Performance: with a synthetic 220-Model fixture (temp directory only — the data package keeps only real data, zero-placeholder pin green) initial render 338–373 ms, sort ~193–233 ms, filter ~60–71 ms — all well under asserted bounds; real page load 158–166 ms locally (~122 kB total gzip transfer, budget-pinned under 250 kB; ≈0.3 s estimated on typical broadband, inside the 2-second target with the method documented honestly in impl-13.md).
- Browser suite expanded to 206 checks (theme switching, mobile scroll, keyboard operation, contrast) plus a perf-check phase; `pnpm test:browser` chains both.
- Gates at merge: validate, lint, test (95 tests), build all PASS.
