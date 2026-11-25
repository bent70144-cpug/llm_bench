# LLM Bench

LLM Bench compares published language-model benchmark results. This glossary fixes the meaning of the terms used in its data, UI, and documentation.

## Scoring

**Average**:
The arithmetic mean of the benchmarks a visitor selected for which a model has a reported Score, always shown with its Coverage count.
_Avoid_: Overall score, ranking score, composite index

**Weighted Average**:
The Average computed with visitor-assigned benchmark weights.
_Avoid_: weighted score

**Coverage**:
The number of selected benchmarks for which a model has a reported Score.
_Avoid_: completion, completeness

## Measurements

**Score**:
A published, sourced measurement of one Model on one Benchmark under a named evaluation setting.
_Avoid_: result, number, estimate

**Published Result**:
A Score reported by a model provider, a paper, or a public leaderboard rather than measured by LLM Bench.
_Avoid_: self-run, internal evaluation

**Model**:
A specific released checkpoint of a language model, identified by a stable id; a new checkpoint is a new Model.
_Avoid_: model family, version

**Benchmark**:
A named evaluation with a defined metric and a 0–100 percent scale that produces Scores.
_Avoid_: test, leaderboard

## Provenance

**Source type**:
The provenance class of a Score: provider, paper, leaderboard, or third-party.
_Avoid_: source, when referring to a URL

**Canonical sources**:
The ordered list of eligible source types, with optional URL patterns, for a Benchmark; decides which reported Score wins.
_Avoid_: preferred source, primary source

**Primary score**:
The single Score per Model and Benchmark used for the Average, highlighting, and charts; other scores for the same pair show alternate evaluation settings.
_Avoid_: best score, canonical score

**Evaluation setting**:
The named conditions under which a Score was produced, drawn from a controlled vocabulary so equivalent labels do not fragment.
_Avoid_: shot count, configuration

## Taxonomy

**Tier**:
A Benchmark's role in the default selection: core or extended.
_Avoid_: category, priority

## Attribution

**Provider**:
The organization that released a Model.
_Avoid_: vendor, publisher

**Reference inference provider**:
A third-party host whose published API rate is recorded for a Model that has no first-party rate; null for first-party rates and self-hosted Models.
_Avoid_: provider, when referring to the source of a rate

**License**:
The coarse category of a Model's distribution terms: proprietary, open-weights, or open-source.
_Avoid_: license terms, license name

**License name**:
The exact license terms of a Model, kept separate from its License category.
_Avoid_: license, when referring to exact terms
