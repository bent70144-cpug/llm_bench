# 07: Score provenance and alternate settings

**What to build:** every number carries visible provenance and its evaluation conditions, so that an analyst can verify it and tell why two published results differ.

**Blocked by:** 04 (real Published Results for 20+ Models).

**Status:** ready-for-agent

- [ ] Each Score links to its source URL and displays Source type, publishedDate and retrievedDate.
- [ ] A tooltip explains that verified means the data owner checked the value and Evaluation setting against the source, not independent reproduction.
- [ ] Alternate Evaluation settings for a Model and Benchmark are listed on the Model page and are excluded from Average and highlighting.
- [ ] Validation enforces exactly one Primary Score per pair and checks each Primary Score against the Benchmark's canonicalSources, including URL patterns.
- [ ] Evaluation settings come from the controlled vocabulary, and adding one is a data PR rather than a schema PR.
