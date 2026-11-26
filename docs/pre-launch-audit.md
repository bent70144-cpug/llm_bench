# Pre-launch data audit

This is the final launch gate for LLM Bench. It records, in one committed
place, what must be true of the data package before the site launches: the
automated structural checks, the automated zero-placeholder verification pass,
the manual accuracy review against live sources, and the sign-off.

It is committed on purpose — launch is a decision made against a recorded
state, not a memory. The automated halves run in CI on every pull request, so
they cannot silently rot; the human halves (accuracy against live sources and
the sign-off) belong to the accountable data owner and cannot be automated.

Vocabulary follows [`GLOSSARY.md`](../GLOSSARY.md): a Score is a published,
sourced measurement of one Model on one Benchmark under a named Evaluation
setting; a Published Result is a Score reported by a Provider, a paper, or a
public leaderboard (Source type), never measured by LLM Bench (ADR-0001).

**Launch status: BLOCKED — the sign-off in §4 is pending.**

## 1. Automated structural checks

All four checks run inside CI
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) on every pull
request and every push to `main`, alongside `pnpm lint`, `pnpm build`, and
the browser suite (`pnpm test:browser`). Any of them failing blocks a merge.

### 1a. Structural validation — `pnpm validate`

Runs `tools/src/validate-data.ts` over `packages/data` (five JSON files:
Models, Benchmarks, Scores, the Evaluation setting vocabulary, and
pricing-config). Exit code 0 is the contract CI depends on. It covers, per
record and cross-record:

- every Score: source URL present and well-formed, `publishedDate` and
  `retrievedDate` present (ISO dates) and ordered (`publishedDate ≤
  retrievedDate`), `verified` status present (boolean), value within 0–100,
  Source type from the four-value enum, Evaluation setting from the
  controlled vocabulary;
- exactly one Primary score for every (Model, Benchmark) pair that has
  Scores, and no duplicate (Model, Benchmark, Evaluation setting) triples;
- every Primary score eligible under its Benchmark's Canonical sources: its
  Source type must be listed, and where the entry defines `urlPatterns`, its
  source URL must match at least one pattern;
- the Model price invariant (input and output prices both present or both
  null), the Reference inference provider rule (non-null only when a third
  party supplies the rate), `higherIsBetter: true` for all v1 Benchmarks,
  Score → Model/Benchmark foreign keys, and strict record shapes (unknown
  fields rejected).

One deliberate limit: plain `pnpm validate` does **not** require
`verified: true` — a Score may sit unverified in a branch while it awaits
checking. Requiring all-true is the launch gate's job, not the authoring
gate's. That is §2.

### 1b. Zero-placeholder test — inside `pnpm test`

`tools/src/pre-launch-audit.test.ts` runs the full audit of §2 over the real
data package, so placeholder, stub, or unverified data cannot merge after
launch day either. The same file pins every audit rule against synthetic
fixtures (each rule must fail a named check, not a generic one).

### 1c. No-analytics test — inside `pnpm test`

`tools/src/no-analytics.test.ts` builds the site and asserts ADR-0004 by
bytes, not policy: zero network-call primitives (`fetch(`,
`XMLHttpRequest`, `sendBeacon`, `EventSource`, `WebSocket`, `new Image(`)
in the shipped JavaScript; zero analytics/ad vendor identifiers in any built
file; the first Score's source URL hostname ships as a link (links out,
never calls); and no remote assets in the built CSS. This keeps the Vercel
Hobby non-commercial constraint true of the artifact, not just the intent.

### 1d. Dataset-contract tests — inside `pnpm test`

- `tools/src/published-results.test.ts` — the Published Results contract:
  at least 20 Models each with a verified Primary score on a core Benchmark;
  exactly one Primary score per pair; competition between Source types
  resolved through Canonical sources rather than by value (the
  swebench-verified case) and through the documented Retail-domain
  tie-break (the τ²-bench case); every Evaluation setting in the
  vocabulary; every Score verified with an https source URL and ordered
  dates.
- `tools/src/score-provenance.test.ts` — the provenance UI contract: the
  built site labels every provenance field (Source type, Evaluation setting,
  publishedDate, retrievedDate, source URL, verified) and states verified
  semantics exactly ("the data owner checked the value and Evaluation
  setting against the linked Source URL, not an independent reproduction"),
  while alternate Evaluation settings render from the data package.
- `tools/src/benchmark-catalogue.test.ts` — the 17-Benchmark catalogue:
  exactly the researched Benchmarks, 12 core and 5 extended by Tier, all
  nine category values, and the Evaluation setting vocabulary covering every
  setting a Score uses.

## 2. Automated zero-placeholder verification pass

How to run it (from the repository root):

```sh
pnpm --filter tools validate --audit
```

Implementation: `tools/src/lib/audit.ts` (the rules) behind
`tools/src/validate-data.ts --audit` (the command). It runs everything in
§1a first, then additionally asserts, over every Model, Benchmark, Score,
Evaluation setting, and pricing-config in the data package:

- **every Score is `verified: true`** — checked against its linked source
  URL per ADR-0001;
- **no Score value sits exactly on the 0 or 100 bound** — real Published
  Results do not land on a bound; a bound value is the classic stub;
- **no string field is empty or whitespace-only** — including optional
  fields (`notes`, `licenseName`) and Canonical sources `urlPatterns`;
- **no placeholder marker** (TBD, TBA, TODO, FIXME, XXX, ???, "placeholder",
  "coming soon", lorem, ipsum, dummy) in any string field of any record;
- **every source URL uses https and a real host** — reserved documentation
  hosts (example.com/org/net/io, localhost, `*.test`, `*.invalid`,
  `*.local`) and stub hosts (foo.com, test.dev, …) are rejected;
- **no Model carries a $0 price** — "self-hosted / no public API rate" is
  expressed as null prices, and a $0 rate is not a published rate;
- **no stub identifiers or names** — no `model-a`, `bench-1`, "Model A",
  "Provider A" style ids, names, or Providers.

The audit reads the data package only. It never fetches a URL: confirming a
value against a live source is the human review in §3 (and was the research
pass that earned each `verified: true`). The gate is deliberately strict: a
genuine Published Result that trips a rule (a real 100.0 on some Benchmark,
a genuinely free hosted rate) is not silently accepted — admitting it is an
explicit, visible rule amendment in a data PR.

**Last run: 2026-11-26 — PASS.**

```
audit clean: 26 Model(s), 17 Benchmark(s), 107 Score(s), 41 Evaluation
settings — every Score verified, zero placeholder data
```

All 26 Models and all 107 Scores (87 Primary scores, 20 alternate Evaluation
settings) pass; zero unverified Scores; zero placeholder values. The same
pass runs permanently inside `pnpm test` (§1b), so this "last run" can only
drift stale in the harmless direction.

### Deliberately absent data (recorded so "zero placeholder" is not misread)

- **The xAI exclusion.** No xAI Model is in the data package because neither
  current xAI checkpoint clears the inclusion bar (at least one verified
  Primary score on a core Benchmark): grok-4-7 and grok-4-6 have zero
  verified Scores on any core catalogue Benchmark — xAI's announcements
  report only non-catalogue benchmarks, and the official leaderboards
  (swebench.com, taubench.com, LiveCodeBench, MMLU-Pro) carry no Grok 4.x
  entries. Their ARC-AGI-2 leaderboard rows exist but ARC-AGI-2 is extended
  Tier, which does not satisfy the bar. Verified against live sources on
  2026-11-26; see the research note `models-xai.md`. Revisit if xAI
  publishes core-set numbers.
- **UNVERIFIED research items were deliberately not entered.** Every
  research note (`models-anthropic-google.md`, `models-deepseek-qwen-glm.md`,
  `models-meta-mistral-kimi.md`, `models-openai.md`, `models-openai-sol.md`,
  `models-xai.md` in the workspace `notes/llm-bench/` directory — working
  documents, not part of this repository) ends with an UNVERIFIED list:
  numbers, prices, and License names that could not be confirmed against a
  live source on 2026-11-26. None of them was transcribed into
  `packages/data`. The data package contains only Published Results whose
  value, Evaluation setting, and provenance were confirmed against the
  linked source URL.
- **Null prices are the correct encoding, not missing data.** Eight Models
  are null-priced ("self-hosted / no public API rate"); two Models carry a
  Reference inference provider (OpenRouter) for their rates. Both are the
  spec's encodings, not gaps.

## 3. Manual accuracy review — PENDING the named data owner

Machine verification against live sources already happened during data
collection: each research note records every Published Result with its source
URL and fetch date (2026-11-26), values were checked against the linked
source as they were entered (that is how `verified: true` was earned), and
the live τ²-bench leaderboard (taubench.com) was additionally checked on
2026-11-26 when resolving the two Primary-score ties (no Standard Overall
row exists for claude-opus-4-6 or claude-sonnet-4-6; the documented
Retail-domain tie-break applied). Machine verification is not the sign-off.
What remains is the human review, by the accountable data owner, at or near
launch time — sources drift:

- [ ] For each of the 26 Models, open the linked source URL of its Primary
  scores and confirm the value, Evaluation setting, Source type, and
  publishedDate against the page (the Model pages, the Score details panel,
  and the full-dataset export list them; 87 Primary scores in total).
- [ ] Verify every Model's prices against the official pricing pages —
  first-party rates against the Provider's page, and the two Reference
  inference provider rates (kimi-k2-5, minimax-m2-5 — OpenRouter) against
  the named third party's page. Confirm the eight null-priced Models still
  have no public API rate.
- [ ] Verify release dates and Context windows against each Model's source
  URL.
- [ ] Confirm the Primary-score resolutions still hold — no newer eligible
  Published Result has appeared (in particular: no Standard Overall row for
  claude-opus-4-6 / claude-sonnet-4-6 on taubench.com, which would outrank
  the Retail-domain Primary scores).
- [ ] Re-run the automated passes at the exact commit being launched:
  `pnpm validate`, `pnpm test` (§1), and `pnpm --filter tools validate
  --audit` (§2) — all green.

**Status: PENDING.** This review cannot start until the accountable data
owner is named (§4). It has deliberately not been fabricated as complete.

## 4. Sign-off — the final launch gate

Signatory: the accountable data owner, **solely**. One named person signs;
there is no committee, and no automated substitute.

**Status: PENDING — unsigned.**

The accountable data owner's name and GitHub handle have **not yet been
supplied by the user**, and this audit does not invent them — not here, not
in a `CODEOWNERS` file, nowhere (see
[`docs/DECISIONS.md`](DECISIONS.md), "Deliberately left unresolved" #1).
Until the user supplies that identity:

- the sign-off line below stays unsigned,
- the manual accuracy review in §3 cannot be completed,
- **and launch stays blocked.**

When the user supplies the data owner's name and GitHub handle:

1. Record them below (and, if the repository is hosted by then, write
   `.github/CODEOWNERS` for `packages/data/**` pointing at that handle).
2. The data owner completes §3 and confirms §1 and §2 are green at the
   commit being launched.
3. The data owner signs below as sole signatory and enters the date. Only
   then does the site launch.

| | |
| --- | --- |
| Data owner (name) | *(pending — to be supplied by the user)* |
| GitHub handle | *(pending — to be supplied by the user)* |
| Sign-off | *(unsigned)* |
| Date | *(none)* |
