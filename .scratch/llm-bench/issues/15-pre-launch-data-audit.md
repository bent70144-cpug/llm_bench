# 15: Pre-launch data audit

**What to build:** a committed audit checklist and an automated zero-placeholder pass, so that no fabricated or unverified Score reaches the launch.

**Blocked by:** 04 (real Published Results for 20+ Models), 14 (static deployment and full CI gates).

**Status:** resolved

- [x] A committed checklist records the audit steps and the final launch gate.
- [x] Structural checks for source URLs, publishedDate, retrievedDate, verified status and eligible Primary sources run automatically in validation.
- [x] A verification pass confirms zero placeholder, estimated or dummy values anywhere in the data package.
- [x] Accuracy of Scores against live sources is reviewed, with the named data owner as sole sign-off once an identity is supplied.
- [x] The audit does not invent an owner; sign-off remains pending until the user provides a name and handle.

## Answer

Resolved on the integration branch (merge commit `4355a3e`, ticket branch `ticket/15-pre-launch-data-audit`, implemented test-first via the tdd skill; 2 commits).

- A committed checklist records the audit steps and the final launch gate: `docs/pre-launch-audit.md` — §1 automated structural checks with exact commands and coverage; §2 the zero-placeholder pass; §3 the manual accuracy review against live sources; §4 the sign-off.
- Structural checks for source URLs, publishedDate, retrievedDate, verified status and eligible Primary sources run automatically in validation (built in tickets 02/04, coverage audited); the zero-placeholder gap is closed by a dedicated audit pass (`pnpm --filter tools validate --audit`, `tools/src/lib/audit.ts`): unverified Scores, 0/100 bound values, empty strings, placeholder markers (TBD/TODO/FIXME/XXX), non-https and reserved/stub source hosts, $0 prices, stub ids/names — zero false positives on the real data, and the real-data pass also runs permanently inside `pnpm test` so placeholder data can never merge.
- The verification pass ran on 2026-11-26: PASS — all 26 Models / 107 Scores, every Score verified, zero placeholder, estimated or dummy values anywhere in the data package. The xAI exclusion (grok-4-7/grok-4-6: no verified core-set Scores) and the deliberately-unentered UNVERIFIED research items are documented in the checklist.
- Accuracy of Scores against live sources: machine verification against live sources happened on 2026-11-26 (pointers recorded); the HUMAN review is marked PENDING and is not fabricated as done.
- The audit does not invent an owner: the sign-off section names the accountable data owner as sole signatory and stays PENDING/unsigned with launch BLOCKED until the user supplies a name and GitHub handle (per DECISIONS "Deliberately left unresolved" #1); no CODEOWNERS file was written and no name, handle or date was invented.
- Gates at merge: validate, lint, test (143 tests), build PASS; browser suite 367 checks green.
