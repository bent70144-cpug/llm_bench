# 15: Pre-launch data audit

**What to build:** a committed audit checklist and an automated zero-placeholder pass, so that no fabricated or unverified Score reaches the launch.

**Blocked by:** 04 (real Published Results for 20+ Models), 14 (static deployment and full CI gates).

**Status:** ready-for-agent

- [ ] A committed checklist records the audit steps and the final launch gate.
- [ ] Structural checks for source URLs, publishedDate, retrievedDate, verified status and eligible Primary sources run automatically in validation.
- [ ] A verification pass confirms zero placeholder, estimated or dummy values anywhere in the data package.
- [ ] Accuracy of Scores against live sources is reviewed, with the named data owner as sole sign-off once an identity is supplied.
- [ ] The audit does not invent an owner; sign-off remains pending until the user provides a name and handle.
