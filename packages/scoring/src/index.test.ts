import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";

import {
  bestValueByBenchmark,
  computeAverage,
  defaultSelectedBenchmarkIds,
  filterModels,
  formatCoverage,
  isUnderHalfCoverage,
  primaryScoreFor,
  primaryScores,
  rankModelsByAverage,
  selectedBenchmarks,
  sortModelsByColumn,
} from "./index";

/**
 * Synthetic Published Results for testing only — the @llm-bench/data
 * package never contains fixtures like these.
 */
function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    modelId: "model-a",
    benchmarkId: "bench-1",
    value: 0,
    evaluationSetting: "5-shot",
    sourceType: "provider",
    sourceUrl: "https://example.com/score",
    publishedDate: "2026-01-01",
    retrievedDate: "2026-01-02",
    verified: true,
    isPrimary: true,
    ...overrides,
  };
}

/** Synthetic Model metadata for testing only. */
function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "model-a",
    name: "Model A",
    provider: "Provider A",
    license: "proprietary",
    releaseDate: "2026-01-01",
    contextWindow: 128000,
    inputPricePer1M: 1.5,
    outputPricePer1M: 3.0,
    referenceInferenceProvider: null,
    lastUpdated: "2026-02-01",
    sourceUrl: "https://example.com/model-a",
    ...overrides,
  };
}

/** Synthetic Benchmark metadata for testing only. */
function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "bench-1",
    name: "Bench 1",
    category: "reasoning",
    description: "A synthetic reasoning Benchmark.",
    metric: "accuracy, %",
    higherIsBetter: true,
    tier: "core",
    sourceUrl: "https://example.com/bench-1",
    canonicalSources: [{ sourceType: "provider" }],
    limitations: "Synthetic fixture.",
    evaluationSettingNotes: "Synthetic fixture.",
    ...overrides,
  };
}

const scores: Score[] = [
  makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
  makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
  // Alternate evaluation setting for the same pair: never part of the Average.
  makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 70, isPrimary: false }),
  makeScore({ modelId: "model-b", benchmarkId: "bench-1", value: 95 }),
];

describe("computeAverage", () => {
  it("returns the mean of the selected Benchmarks with a Primary score, ignoring non-primary Scores", () => {
    const result = computeAverage("model-a", scores, {
      benchmarkIds: ["bench-1", "bench-2", "bench-3"],
    });

    // (80 + 90) / 2 = 85; the non-primary 70 on bench-2 must not be averaged in.
    expect(result).toEqual({ average: 85, coverage: 2, selected: 3 });
  });

  it("returns a null Average for a Model with no Primary score among the selected Benchmarks", () => {
    const result = computeAverage("model-c", scores, {
      benchmarkIds: ["bench-1", "bench-2", "bench-3"],
    });

    expect(result).toEqual({ average: null, coverage: 0, selected: 3 });
  });

  it("averages only over the selected Benchmarks", () => {
    const result = computeAverage("model-a", scores, { benchmarkIds: ["bench-2"] });

    expect(result).toEqual({ average: 90, coverage: 1, selected: 1 });
  });

  it("ignores duplicate Benchmark ids in the selection", () => {
    const result = computeAverage("model-a", scores, {
      benchmarkIds: ["bench-1", "bench-1", "bench-2"],
    });

    expect(result).toEqual({ average: 85, coverage: 2, selected: 2 });
  });
});

describe("primaryScores", () => {
  it("returns only the Primary scores", () => {
    const primary = primaryScores(scores);

    expect(primary).toHaveLength(3);
    expect(primary.every((score) => score.isPrimary)).toBe(true);
  });
});

describe("primaryScoreFor", () => {
  it("returns the Primary score for a Model and Benchmark pair", () => {
    const score = primaryScoreFor("model-a", "bench-2", scores);

    expect(score?.value).toBe(90);
  });

  it("returns undefined when the Model has no Primary score for the Benchmark", () => {
    expect(primaryScoreFor("model-b", "bench-2", scores)).toBeUndefined();
    expect(primaryScoreFor("model-c", "bench-1", scores)).toBeUndefined();
  });
});

describe("bestValueByBenchmark", () => {
  it("maps each Benchmark to the highest Primary score value, ignoring non-primary Scores", () => {
    const withHighAlternate = [
      ...scores,
      // A non-primary 99 must not become the best value for bench-1.
      makeScore({ modelId: "model-b", benchmarkId: "bench-1", value: 99, isPrimary: false }),
    ];

    const best = bestValueByBenchmark(withHighAlternate);

    expect(best.get("bench-1")).toBe(95);
    expect(best.get("bench-2")).toBe(90);
    expect(best.has("bench-3")).toBe(false);
  });
});

describe("defaultSelectedBenchmarkIds", () => {
  it("returns the ids of the core-Tier Benchmarks in catalogue order", () => {
    const catalogue = [
      makeBenchmark({ id: "bench-1", tier: "core" }),
      makeBenchmark({ id: "bench-2", tier: "extended" }),
      makeBenchmark({ id: "bench-3", tier: "core" }),
    ];

    expect(defaultSelectedBenchmarkIds(catalogue)).toEqual(["bench-1", "bench-3"]);
  });

  it("returns an empty selection when no Benchmark is core Tier", () => {
    const catalogue = [makeBenchmark({ id: "bench-1", tier: "extended" })];

    expect(defaultSelectedBenchmarkIds(catalogue)).toEqual([]);
    expect(defaultSelectedBenchmarkIds([])).toEqual([]);
  });
});

describe("selectedBenchmarks", () => {
  const catalogue = [
    makeBenchmark({ id: "bench-1" }),
    makeBenchmark({ id: "bench-2" }),
    makeBenchmark({ id: "bench-3" }),
  ];

  it("derives the Benchmark columns in catalogue order, whatever the selection order", () => {
    const columns = selectedBenchmarks(catalogue, ["bench-3", "bench-1"]);

    expect(columns.map((benchmark) => benchmark.id)).toEqual(["bench-1", "bench-3"]);
  });

  it("ignores unknown ids and duplicate selections", () => {
    expect(selectedBenchmarks(catalogue, ["bench-1", "nope", "bench-1"]).map((b) => b.id)).toEqual(
      ["bench-1"],
    );
  });

  it("returns no columns for an empty selection", () => {
    expect(selectedBenchmarks(catalogue, [])).toEqual([]);
  });
});

describe("sortModelsByColumn", () => {
  // Three scored Models plus one with no Scores at all.
  const sortableModels: Model[] = [
    makeModel({
      id: "model-a",
      name: "Alpha One",
      provider: "Zed AI",
      license: "open-weights",
      contextWindow: 100000,
      inputPricePer1M: 2.0,
      outputPricePer1M: 4.0,
    }),
    makeModel({
      id: "model-b",
      name: "beta two",
      provider: "Acme Labs",
      license: "proprietary",
      contextWindow: 200000,
      inputPricePer1M: null,
      outputPricePer1M: null,
    }),
    makeModel({
      id: "model-c",
      name: "Gamma",
      provider: "Zed AI",
      license: "open-source",
      contextWindow: 400000,
      inputPricePer1M: 1.0,
      outputPricePer1M: 2.0,
    }),
    makeModel({ id: "model-d", name: "Delta", provider: "Acme Labs" }),
  ];

  const leaderboardScores: Score[] = [
    makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
    makeScore({ modelId: "model-b", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-c", benchmarkId: "bench-2", value: 85 }),
    // A non-primary Score on bench-1 must never drive the sort.
    makeScore({ modelId: "model-c", benchmarkId: "bench-1", value: 99, isPrimary: false }),
  ];

  const context = { scores: leaderboardScores, benchmarkIds: ["bench-1", "bench-2"] };

  it("sorts by Model name case-insensitively in both directions", () => {
    const asc = sortModelsByColumn(sortableModels, { column: "model-name", direction: "asc" }, context);
    expect(asc.map((model) => model.id)).toEqual(["model-a", "model-b", "model-d", "model-c"]);

    const desc = sortModelsByColumn(sortableModels, { column: "model-name", direction: "desc" }, context);
    expect(desc.map((model) => model.id)).toEqual(["model-c", "model-d", "model-b", "model-a"]);
  });

  it("sorts numerically by Context window", () => {
    const desc = sortModelsByColumn(sortableModels, { column: "context-window", direction: "desc" }, context);
    expect(desc.map((model) => model.id)).toEqual(["model-c", "model-b", "model-d", "model-a"]);
  });

  it("sorts null prices last in both directions — never as zero", () => {
    const asc = sortModelsByColumn(sortableModels, { column: "input-price", direction: "asc" }, context);
    expect(asc.map((model) => model.id)).toEqual(["model-c", "model-d", "model-a", "model-b"]);

    const desc = sortModelsByColumn(sortableModels, { column: "input-price", direction: "desc" }, context);
    expect(desc.map((model) => model.id)).toEqual(["model-a", "model-d", "model-c", "model-b"]);
  });

  it("sorts a Benchmark column by its Primary scores, with missing Scores last", () => {
    const desc = sortModelsByColumn(sortableModels, { column: "bench-1", direction: "desc" }, context);
    // model-c's 99 on bench-1 is non-primary, so it sorts as missing, below 80.
    expect(desc.map((model) => model.id)).toEqual(["model-b", "model-a", "model-c", "model-d"]);

    const asc = sortModelsByColumn(sortableModels, { column: "bench-1", direction: "asc" }, context);
    expect(asc.map((model) => model.id)).toEqual(["model-a", "model-b", "model-c", "model-d"]);
  });

  it("sorts by Average with null Averages last, ties broken by higher Coverage", () => {
    // Averages: model-a (80+90)/2 = 85 Coverage 2, model-b 90 Coverage 1,
    // model-c 85 Coverage 1, model-d null. The 85 tie breaks to model-a
    // (higher Coverage), not to data-package order.
    const desc = sortModelsByColumn(sortableModels, { column: "average", direction: "desc" }, context);
    expect(desc.map((model) => model.id)).toEqual(["model-b", "model-a", "model-c", "model-d"]);

    const asc = sortModelsByColumn(sortableModels, { column: "average", direction: "asc" }, context);
    expect(asc.map((model) => model.id)).toEqual(["model-a", "model-c", "model-b", "model-d"]);
  });

  it("sorts by Coverage over the selected Benchmarks", () => {
    const desc = sortModelsByColumn(sortableModels, { column: "coverage", direction: "desc" }, context);
    expect(desc.map((model) => model.id)).toEqual(["model-a", "model-b", "model-c", "model-d"]);
  });

  it("sorts by Provider and License strings", () => {
    const byProvider = sortModelsByColumn(sortableModels, { column: "provider", direction: "asc" }, context);
    expect(byProvider.map((model) => model.id)).toEqual(["model-b", "model-d", "model-a", "model-c"]);

    const byLicense = sortModelsByColumn(sortableModels, { column: "license", direction: "asc" }, context);
    expect(byLicense.map((model) => model.id)).toEqual(["model-c", "model-a", "model-b", "model-d"]);
  });
});

describe("sortModelsByColumn ranking tie-breaks", () => {
  /**
   * Hand-computed tie-break fixtures. Selection: bench-1, bench-2.
   *
   * - model-high   "High Model"  bench-1 90          → Average 90, Coverage 1
   * - model-pair-a "Pair A"      bench-1 80, bench-2 80 → Average 80, Coverage 2
   * - model-pair-b "Zebra Pair"  bench-1 80, bench-2 80 → Average 80, Coverage 2
   * - model-solo   "Solo Model"  bench-1 80          → Average 80, Coverage 1
   * - model-none   "None Model"  no Scores           → null Average
   *
   * Data order deliberately puts Zebra Pair before Pair A and Solo Model
   * before High Model, so a stable-data-order sort and the deterministic
   * ranking chain produce DIFFERENT orders on ties.
   */
  const tieModels: Model[] = [
    makeModel({ id: "model-pair-b", name: "Zebra Pair" }),
    makeModel({ id: "model-solo", name: "Solo Model" }),
    makeModel({ id: "model-high", name: "High Model" }),
    makeModel({ id: "model-pair-a", name: "Pair A" }),
    makeModel({ id: "model-none", name: "None Model" }),
  ];

  const tieScores: Score[] = [
    makeScore({ modelId: "model-high", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-pair-a", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-pair-a", benchmarkId: "bench-2", value: 80 }),
    makeScore({ modelId: "model-pair-b", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-pair-b", benchmarkId: "bench-2", value: 80 }),
    makeScore({ modelId: "model-solo", benchmarkId: "bench-1", value: 80 }),
  ];

  const tieContext = { scores: tieScores, benchmarkIds: ["bench-1", "bench-2"] };

  it("sorting the Average column descending is exactly the ranking", () => {
    const sorted = sortModelsByColumn(tieModels, { column: "average", direction: "desc" }, tieContext);

    expect(sorted.map((model) => model.id)).toEqual([
      "model-high", // Average 90
      "model-pair-a", // Average 80, Coverage 2, "Pair A"
      "model-pair-b", // Average 80, Coverage 2, "Zebra Pair" — name, not data order
      "model-solo", // Average 80, Coverage 1
      "model-none", // null Average
    ]);
    expect(sorted.map((model) => model.id)).toEqual(
      rankModelsByAverage(tieModels, tieContext).map((model) => model.id),
    );
  });

  it("sorting the Average column ascending still breaks ties by the chain and keeps nulls last", () => {
    const asc = sortModelsByColumn(tieModels, { column: "average", direction: "asc" }, tieContext);

    expect(asc.map((model) => model.id)).toEqual([
      "model-pair-a", // Average 80, Coverage 2, "Pair A"
      "model-pair-b", // Average 80, Coverage 2, "Zebra Pair"
      "model-solo", // Average 80, Coverage 1
      "model-high", // Average 90
      "model-none", // null Average — last even when ascending
    ]);
  });

  it("breaks Benchmark-column ties by higher Coverage then name, with missing Scores last in both directions", () => {
    const desc = sortModelsByColumn(tieModels, { column: "bench-1", direction: "desc" }, tieContext);
    expect(desc.map((model) => model.id)).toEqual([
      "model-high", // 90
      "model-pair-a", // 80, Coverage 2, "Pair A"
      "model-pair-b", // 80, Coverage 2, "Zebra Pair"
      "model-solo", // 80, Coverage 1
      "model-none", // missing — last, never zero
    ]);

    const asc = sortModelsByColumn(tieModels, { column: "bench-1", direction: "asc" }, tieContext);
    // The 80 tie keeps the same deterministic order in both directions.
    expect(asc.map((model) => model.id)).toEqual([
      "model-pair-a",
      "model-pair-b",
      "model-solo",
      "model-high", // 90
      "model-none", // missing — last in both directions
    ]);
  });

  it("keeps stable data-package-order ties on Model-field columns", () => {
    // Coverage values: pair-b 2, solo 1, high 1, pair-a 2, none 0. The ties
    // keep data-package order (Zebra Pair before Pair A, Solo Model before
    // High Model) — the ranking chain applies only to the Average column
    // and Benchmark columns.
    const desc = sortModelsByColumn(tieModels, { column: "coverage", direction: "desc" }, tieContext);
    expect(desc.map((model) => model.id)).toEqual([
      "model-pair-b",
      "model-pair-a",
      "model-solo",
      "model-high",
      "model-none",
    ]);
  });
});

describe("rankModelsByAverage", () => {
  /**
   * Hand-computed ranking fixtures. Selection: bench-1, bench-2, bench-3.
   *
   * - model-narrow  "Narrow Model"    bench-1 90                     → Average 90, Coverage 1
   * - model-wide    "Wide Model"      bench-1 80, bench-2 90         → Average 85, Coverage 2
   * - model-tie-high "Tie High Model" bench-1 80, bench-2 70, bench-3 90 → Average 80, Coverage 3
   * - model-name-a  "alpha model"     bench-1 75, bench-2 85         → Average 80, Coverage 2
   * - model-tie-low "Tie Low Model"   bench-1 70, bench-2 90         → Average 80, Coverage 2
   * - model-name-z  "Zeta Model"      bench-1 70, bench-2 90         → Average 80, Coverage 2
   * - model-unscored-a "alpha unscored", model-unscored-z "Zulu Unscored" → null Average
   *
   * model-tie-low also carries a NON-primary 99 on bench-3 that must never
   * reach its Average (it would become 86.3 over Coverage 3 and rank 2nd).
   */
  const rankingModels: Model[] = [
    makeModel({ id: "model-wide", name: "Wide Model" }),
    makeModel({ id: "model-tie-low", name: "Tie Low Model" }),
    makeModel({ id: "model-name-z", name: "Zeta Model" }),
    makeModel({ id: "model-narrow", name: "Narrow Model" }),
    makeModel({ id: "model-unscored-z", name: "Zulu Unscored" }),
    makeModel({ id: "model-tie-high", name: "Tie High Model" }),
    makeModel({ id: "model-name-a", name: "alpha model" }),
    makeModel({ id: "model-unscored-a", name: "alpha unscored" }),
  ];

  const rankingScores: Score[] = [
    makeScore({ modelId: "model-narrow", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-wide", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-wide", benchmarkId: "bench-2", value: 90 }),
    makeScore({ modelId: "model-tie-high", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-tie-high", benchmarkId: "bench-2", value: 70 }),
    makeScore({ modelId: "model-tie-high", benchmarkId: "bench-3", value: 90 }),
    makeScore({ modelId: "model-name-a", benchmarkId: "bench-1", value: 75 }),
    makeScore({ modelId: "model-name-a", benchmarkId: "bench-2", value: 85 }),
    makeScore({ modelId: "model-tie-low", benchmarkId: "bench-1", value: 70 }),
    makeScore({ modelId: "model-tie-low", benchmarkId: "bench-2", value: 90 }),
    makeScore({ modelId: "model-name-z", benchmarkId: "bench-1", value: 70 }),
    makeScore({ modelId: "model-name-z", benchmarkId: "bench-2", value: 90 }),
    // The non-primary trap: never part of the Average, Coverage, or ranking.
    makeScore({ modelId: "model-tie-low", benchmarkId: "bench-3", value: 99, isPrimary: false }),
  ];

  const rankingContext = {
    scores: rankingScores,
    benchmarkIds: ["bench-1", "bench-2", "bench-3"],
  };

  it("ranks by Average descending, ties by higher Coverage then Model name, null-Average Models last in name order", () => {
    const ranked = rankModelsByAverage(rankingModels, rankingContext);

    expect(ranked.map((model) => model.id)).toEqual([
      "model-narrow", // Average 90
      "model-wide", // Average 85
      "model-tie-high", // Average 80, Coverage 3 beats Coverage 2
      // Average 80, Coverage 2, alphabetical case-insensitive name:
      "model-name-a", // "alpha model"
      "model-tie-low", // "Tie Low Model"
      "model-name-z", // "Zeta Model"
      // null Averages last, alphabetical case-insensitive name:
      "model-unscored-a", // "alpha unscored"
      "model-unscored-z", // "Zulu Unscored"
    ]);
  });

  it("never lets a non-primary Score change the Average, Coverage, or ranking", () => {
    // The trap Score removed entirely — the ranking must be identical.
    const withoutNonPrimary = rankModelsByAverage(rankingModels, {
      scores: rankingScores.filter((score) => score.isPrimary),
      benchmarkIds: rankingContext.benchmarkIds,
    });

    expect(withoutNonPrimary.map((model) => model.id)).toEqual(
      rankModelsByAverage(rankingModels, rankingContext).map((model) => model.id),
    );
    // And the trapped Model's numbers are exactly the hand-computed ones.
    expect(computeAverage("model-tie-low", rankingScores, { benchmarkIds: ["bench-1", "bench-2", "bench-3"] })).toEqual({
      average: 80,
      coverage: 2,
      selected: 3,
    });
  });

  it("counts Coverage against the active selection and reranks when it changes", () => {
    // Selection narrowed to bench-2 only: Narrow/Zeta lose their only Score
    // and drop to the null-Average group.
    const ranked = rankModelsByAverage(rankingModels, {
      scores: rankingScores,
      benchmarkIds: ["bench-2"],
    });

    expect(ranked.map((model) => model.id)).toEqual([
      // Average 90, Coverage 1, alphabetical: "Tie Low Model", "Wide Model", "Zeta Model"
      "model-tie-low",
      "model-wide",
      "model-name-z",
      "model-name-a", // Average 85
      "model-tie-high", // Average 70
      // null Averages — bench-2 has no Primary score for them — by name:
      "model-unscored-a", // "alpha unscored"
      "model-narrow", // "Narrow Model" (its only Score is on unselected bench-1)
      "model-unscored-z", // "Zulu Unscored"
    ]);
  });
});

describe("formatCoverage", () => {
  it("renders the Coverage display form (n/selected)", () => {
    expect(formatCoverage({ average: 85, coverage: 2, selected: 3 })).toBe("(2/3)");
    expect(formatCoverage({ average: 90, coverage: 12, selected: 12 })).toBe("(12/12)");
  });

  it("renders (0/selected) for a null-Average Model — never a zero Coverage that hides", () => {
    expect(formatCoverage({ average: null, coverage: 0, selected: 12 })).toBe("(0/12)");
  });
});

describe("isUnderHalfCoverage", () => {
  it("is true strictly below 50% of the selected Benchmarks", () => {
    expect(isUnderHalfCoverage({ average: 94.2, coverage: 1, selected: 12 })).toBe(true);
    expect(isUnderHalfCoverage({ average: 83.2, coverage: 5, selected: 12 })).toBe(true);
    expect(isUnderHalfCoverage({ average: null, coverage: 0, selected: 12 })).toBe(true);
  });

  it("is false at exactly 50% — 'under 50%' excludes the boundary — and above it", () => {
    expect(isUnderHalfCoverage({ average: 85.3, coverage: 6, selected: 12 })).toBe(false);
    expect(isUnderHalfCoverage({ average: 90, coverage: 1, selected: 1 })).toBe(false);
    expect(isUnderHalfCoverage({ average: 90, coverage: 2, selected: 3 })).toBe(false);
  });

  it("is false when no Benchmark is selected — there is no Coverage to be under", () => {
    expect(isUnderHalfCoverage({ average: null, coverage: 0, selected: 0 })).toBe(false);
  });
});

describe("leaderboard pipeline composition (filter, then rank or sort)", () => {
  /**
   * Hand-computed composition fixtures. Selection: bench-1, bench-2, bench-3.
   *
   * - model-aa "AA Model" Zed AI, open-weights, 100k ctx, $2/$4 — bench-1 70, bench-2 90 → Average 80, Coverage 2
   * - model-bb "BB Model" Zed AI, proprietary, 400k ctx, $1/$2 — bench-1 90 → Average 90, Coverage 1
   * - model-cc "CC Model" Acme, open-weights, 200k ctx, self-hosted — bench-1 80, bench-2 70, bench-3 90 → Average 80, Coverage 3
   * - model-dd "DD Model" Acme, proprietary, 128k ctx, $1.5/$3 — no Scores → null Average
   */
  const pipelineModels: Model[] = [
    makeModel({
      id: "model-aa",
      name: "AA Model",
      provider: "Zed AI",
      license: "open-weights",
      contextWindow: 100000,
      inputPricePer1M: 2.0,
      outputPricePer1M: 4.0,
    }),
    makeModel({
      id: "model-bb",
      name: "BB Model",
      provider: "Zed AI",
      license: "proprietary",
      contextWindow: 400000,
      inputPricePer1M: 1.0,
      outputPricePer1M: 2.0,
    }),
    makeModel({
      id: "model-cc",
      name: "CC Model",
      provider: "Acme",
      license: "open-weights",
      contextWindow: 200000,
      inputPricePer1M: null,
      outputPricePer1M: null,
    }),
    makeModel({
      id: "model-dd",
      name: "DD Model",
      provider: "Acme",
      license: "proprietary",
      contextWindow: 128000,
      inputPricePer1M: 1.5,
      outputPricePer1M: 3.0,
    }),
  ];

  const pipelineScores: Score[] = [
    makeScore({ modelId: "model-aa", benchmarkId: "bench-1", value: 70 }),
    makeScore({ modelId: "model-aa", benchmarkId: "bench-2", value: 90 }),
    makeScore({ modelId: "model-bb", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-cc", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-cc", benchmarkId: "bench-2", value: 70 }),
    makeScore({ modelId: "model-cc", benchmarkId: "bench-3", value: 90 }),
  ];

  const pipelineContext = {
    scores: pipelineScores,
    benchmarkIds: ["bench-1", "bench-2", "bench-3"],
  };

  it("applies search, License, and Context window filters together before ranking", () => {
    // Search "model" matches every name; the License filter keeps both
    // categories; the Context window floor of 150000 drops AA (100k) and
    // DD (128k) — so the ranked pipeline shows exactly BB then CC.
    const shortlist = filterModels(pipelineModels, {
      search: "MODEL",
      licenses: ["open-weights", "proprietary"],
      minContextWindow: 150000,
    });
    expect(shortlist.map((model) => model.id)).toEqual(["model-bb", "model-cc"]);

    expect(rankModelsByAverage(shortlist, pipelineContext).map((model) => model.id)).toEqual([
      "model-bb", // Average 90
      "model-cc", // Average 80
    ]);

    // Without the filters the ranking carries all four Models, in rank order.
    expect(rankModelsByAverage(pipelineModels, pipelineContext).map((model) => model.id)).toEqual([
      "model-bb", // Average 90
      "model-cc", // Average 80, Coverage 3
      "model-aa", // Average 80, Coverage 2
      "model-dd", // null Average
    ]);
  });

  it("sorts the filtered shortlist by any column, with the ranking tie-breaks", () => {
    const shortlist = filterModels(pipelineModels, {
      search: "model",
      minContextWindow: 150000,
    });

    // Sorting the shortlist by a Benchmark column: CC's 70 on bench-2 beats
    // BB's missing Score, which still sorts last — never as zero.
    const byBenchmark = sortModelsByColumn(
      shortlist,
      { column: "bench-2", direction: "desc" },
      pipelineContext,
    );
    expect(byBenchmark.map((model) => model.id)).toEqual(["model-cc", "model-bb"]);

    const byPrice = sortModelsByColumn(
      shortlist,
      { column: "input-price", direction: "asc" },
      pipelineContext,
    );
    expect(byPrice.map((model) => model.id)).toEqual(["model-bb", "model-cc"]);
  });
});

describe("filterModels", () => {
  const filterableModels: Model[] = [
    makeModel({
      id: "model-a",
      name: "Alpha One",
      provider: "Zed AI",
      license: "open-weights",
      contextWindow: 100000,
      inputPricePer1M: 2.0,
      outputPricePer1M: 4.0,
    }),
    makeModel({
      id: "model-b",
      name: "beta two",
      provider: "Acme Labs",
      license: "proprietary",
      contextWindow: 200000,
      inputPricePer1M: null,
      outputPricePer1M: null,
    }),
    makeModel({
      id: "model-c",
      name: "Gamma",
      provider: "Zed AI",
      license: "open-source",
      contextWindow: 400000,
      inputPricePer1M: 1.0,
      outputPricePer1M: 2.0,
    }),
  ];

  it("returns every Model when the query is empty", () => {
    expect(filterModels(filterableModels, {})).toEqual(filterableModels);
    expect(filterModels(filterableModels, { search: "   " })).toEqual(filterableModels);
  });

  it("searches by Model name or Provider, case-insensitively", () => {
    expect(filterModels(filterableModels, { search: "zed" }).map((m) => m.id)).toEqual([
      "model-a",
      "model-c",
    ]);
    expect(filterModels(filterableModels, { search: "BETA" }).map((m) => m.id)).toEqual(["model-b"]);
    expect(filterModels(filterableModels, { search: "no-such-model" })).toEqual([]);
  });

  it("filters by the strict three-value License categories", () => {
    expect(filterModels(filterableModels, { licenses: ["open-weights"] }).map((m) => m.id)).toEqual([
      "model-a",
    ]);
    expect(
      filterModels(filterableModels, { licenses: ["proprietary", "open-source"] }).map((m) => m.id),
    ).toEqual(["model-b", "model-c"]);
    expect(filterModels(filterableModels, { licenses: [] })).toEqual(filterableModels);
  });

  it("filters by Provider", () => {
    expect(filterModels(filterableModels, { providers: ["Acme Labs"] }).map((m) => m.id)).toEqual([
      "model-b",
    ]);
  });

  it("filters by a minimum Context window", () => {
    expect(
      filterModels(filterableModels, { minContextWindow: 150000 }).map((m) => m.id),
    ).toEqual(["model-b", "model-c"]);
  });

  it("filters by maximum prices, excluding Models with no public API rate", () => {
    expect(
      filterModels(filterableModels, { maxInputPricePer1M: 1.5 }).map((m) => m.id),
    ).toEqual(["model-c"]);
    expect(
      filterModels(filterableModels, { maxOutputPricePer1M: 3.0 }).map((m) => m.id),
    ).toEqual(["model-c"]);
  });

  it("combines filters with AND semantics", () => {
    expect(
      filterModels(filterableModels, { search: "gamma", minContextWindow: 500000 }),
    ).toEqual([]);
    expect(
      filterModels(filterableModels, {
        providers: ["Zed AI"],
        licenses: ["open-weights"],
        minContextWindow: 50000,
        maxInputPricePer1M: 5,
      }).map((m) => m.id),
    ).toEqual(["model-a"]);
  });
});
