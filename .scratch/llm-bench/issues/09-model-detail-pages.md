# 09: Model detail pages

**What to build:** a routed page for every Model with all its Scores and practical details, so that a developer can evaluate one Model without cross-referencing other pages.

**Blocked by:** 07 (score provenance and alternate settings), 08 (benchmark detail pages).

**Status:** ready-for-agent

- [ ] Each Model has a directly addressable page showing every Score, both prices, Context window, release date, Provider, License and License name, source links and notes.
- [ ] The header shows the latest of the Model's metadata update date and its Scores' retrievedDate values.
- [ ] Null prices read "self-hosted / no public API rate", and a Reference inference provider is named whenever a third party supplies the rate.
- [ ] A chart compares the Model against the Benchmark leader on each Benchmark, using Primary scores and showing "n/a" for gaps.
- [ ] Direct navigation and refresh work on Model routes, and all controls are keyboard-operable.
