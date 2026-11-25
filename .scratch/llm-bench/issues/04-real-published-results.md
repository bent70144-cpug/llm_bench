# 04: Real Published Results for 20+ Models

**What to build:** a leaderboard seeded with real, verified published results for both proprietary and open-weight Models, so that visitors see defensible current numbers rather than fabricated ones.

**Blocked by:** 03 (benchmark catalogue and dynamic columns).

**Status:** ready-for-agent

- [ ] At least 20 Models are present, each with a verified public Score in the core set and complete required metadata.
- [ ] Every Score has an Evaluation setting, Source type, source URL, publishedDate, retrievedDate and verified status, and at least one Primary Score exists per Model and Benchmark pair that has Scores.
- [ ] Competing published numbers resolve through each Benchmark's canonicalSources, with ties broken by newest publishedDate.
- [ ] New model checkpoints are separate Models rather than overwrites, and corrections to the same checkpoint are traceable in version history.
- [ ] The data package contains no placeholder or estimated Score, and validation and the browser suite both pass.
