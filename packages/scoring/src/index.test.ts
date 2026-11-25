import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { scores as publishedScores } from "@llm-bench/data";

import {
  bestValueByBenchmark,
  computeAverage,
  computeWeightedAverage,
  defaultSelectedBenchmarkIds,
  filterModels,
  formatCoverage,
  isUnderHalfCoverage,
  primaryScoreFor,
  primaryScores,
  rankModelsByAverage,
  scoresForPair,
  selectedBenchmarks,
  sortModelsByColumn,
  weightsAreActive,
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

describe("computeWeightedAverage", () => {
  // Two Models with symmetric Profiles over two Benchmarks: plain Averages
  // tie at 80, so only the weights can separate them.
  const weightedScores: Score[] = [
    makeScore({ modelId: "model-p", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-p", benchmarkId: "bench-2", value: 70 }),
    makeScore({ modelId: "model-q", benchmarkId: "bench-1", value: 70 }),
    makeScore({ modelId: "model-q", benchmarkId: "bench-2", value: 90 }),
    // A sparse Model: its only Primary score is on bench-1.
    makeScore({ modelId: "model-s", benchmarkId: "bench-1", value: 90 }),
  ];
  const bothBenchmarks = ["bench-1", "bench-2"];

  it("weights each covered Benchmark and normalizes by the weights of the Benchmarks the Model has", () => {
    // Model A on the shared fixture: 80 and 90 with weights {2, 1}:
    // (2*80 + 1*90) / (2 + 1) = 250/3 ≈ 83.33.
    const result = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 2, "bench-2": 1 },
    });

    expect(result).toEqual({ average: 250 / 3, coverage: 2, selected: 2 });
  });

  it("swapping the weights swaps the emphasis — {2,1} vs {1,2} reorder the Models", () => {
    // Model P (90, 70) vs Model Q (70, 90): plain Averages tie at 80.
    // Weights {bench-1: 2, bench-2: 1}: P = 250/3 ≈ 83.33, Q = 230/3 ≈ 76.67.
    // Weights {bench-1: 1, bench-2: 2}: P = 230/3, Q = 250/3 — reversed.
    const first = computeWeightedAverage("model-p", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 2, "bench-2": 1 },
    });
    const second = computeWeightedAverage("model-q", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 2, "bench-2": 1 },
    });
    expect(first.average).toBe(250 / 3);
    expect(second.average).toBe(230 / 3);
    expect((first.average ?? 0) > (second.average ?? 0)).toBe(true);

    const flipped = computeWeightedAverage("model-p", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 1, "bench-2": 2 },
    });
    const flippedOther = computeWeightedAverage("model-q", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 1, "bench-2": 2 },
    });
    expect(flipped.average).toBe(230 / 3);
    expect(flippedOther.average).toBe(250 / 3);
    expect((flippedOther.average ?? 0) > (flipped.average ?? 0)).toBe(true);
  });

  it("a sparse Model is not penalized: a weight applies only to the Benchmarks it has", () => {
    // Model S has only bench-1 (the double-weighted Benchmark): its
    // Weighted Average is its single score, 90 — normalized by 2/2, not
    // counted as missing bench-2.
    const result = computeWeightedAverage("model-s", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 2, "bench-2": 1 },
    });

    expect(result).toEqual({ average: 90, coverage: 1, selected: 2 });
  });

  it("all-default weights reproduce the plain Average exactly", () => {
    const plain = computeAverage("model-a", scores, { benchmarkIds: bothBenchmarks });
    const noWeights = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: {},
    });
    const defaultWeights = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 1, "bench-2": 1 },
    });

    expect(noWeights).toEqual(plain);
    expect(defaultWeights).toEqual(plain);
  });

  it("returns a null aggregate when no Benchmark is selected", () => {
    const result = computeWeightedAverage("model-a", scores, {
      benchmarkIds: [],
      weights: { "bench-1": 2 },
    });

    expect(result).toEqual({ average: null, coverage: 0, selected: 0 });
  });

  it("a weight of 0 excludes a Benchmark from the aggregate but keeps it in Coverage", () => {
    // Weight 0 on bench-1: the aggregate is 90/1 = 90 — bench-1 no longer
    // contributes — but Coverage still counts both Benchmarks (Coverage is
    // unweighted).
    const result = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 0, "bench-2": 1 },
    });

    expect(result).toEqual({ average: 90, coverage: 2, selected: 2 });
  });

  it("a Model whose covered Benchmarks all carry weight 0 has no Weighted Average", () => {
    // Model S only has bench-1, and bench-1 is excluded by weight 0: the
    // normalization would divide by 0, so the aggregate is null — the Model
    // sorts with the null-aggregate Models, "n/a", never zero.
    const result = computeWeightedAverage("model-s", weightedScores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 0, "bench-2": 1 },
    });

    expect(result).toEqual({ average: null, coverage: 1, selected: 2 });
  });

  it("ignores non-primary Scores and weights on unselected Benchmarks", () => {
    // The non-primary 70 on bench-2 must not feed the aggregate; a weight
    // on bench-3 (not selected) changes nothing.
    const result = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": 1, "bench-2": 1, "bench-3": 5 },
    });

    expect(result).toEqual({ average: 85, coverage: 2, selected: 2 });
  });

  it("treats invalid weights (negative, non-finite) as the default 1", () => {
    const result = computeWeightedAverage("model-a", scores, {
      benchmarkIds: bothBenchmarks,
      weights: { "bench-1": -3, "bench-2": Number.POSITIVE_INFINITY },
    });

    expect(result).toEqual({ average: 85, coverage: 2, selected: 2 });
  });

  it("yields the same Coverage display and badge inputs as the plain Average", () => {
    // Coverage is unweighted: formatCoverage and isUnderHalfCoverage read
    // the same (n/selected) whether or not weights are active. Model S
    // covers 1 of 3 selected Benchmarks — under 50%, so badged.
    const weighted = computeWeightedAverage("model-s", weightedScores, {
      benchmarkIds: ["bench-1", "bench-2", "bench-3"],
      weights: { "bench-1": 2, "bench-2": 1 },
    });

    expect(formatCoverage(weighted)).toBe("(1/3)");
    expect(isUnderHalfCoverage(weighted)).toBe(true);
  });
});

describe("weightsAreActive", () => {
  it("is false when no weight is set or every set weight is the default 1", () => {
    expect(weightsAreActive({}, ["bench-1", "bench-2"])).toBe(false);
    expect(weightsAreActive({ "bench-1": 1, "bench-2": 1 }, ["bench-1", "bench-2"])).toBe(false);
  });

  it("is true when any selected Benchmark carries a non-default weight", () => {
    expect(weightsAreActive({ "bench-1": 2 }, ["bench-1", "bench-2"])).toBe(true);
    // 0 is non-default too: it excludes the Benchmark from the aggregate.
    expect(weightsAreActive({ "bench-1": 0 }, ["bench-1", "bench-2"])).toBe(true);
    expect(weightsAreActive({ "bench-1": 0.5 }, ["bench-1", "bench-2"])).toBe(true);
  });

  it("is false when the non-default weight sits on an unselected Benchmark", () => {
    // The label describes the number actually displayed: a remembered
    // weight on a Benchmark outside the selection does not change the
    // computed value, so the aggregate stays a plain Average.
    expect(weightsAreActive({ "bench-3": 2 }, ["bench-1", "bench-2"])).toBe(false);
  });

  it("is false for invalid weights (negative, non-finite)", () => {
    expect(weightsAreActive({ "bench-1": -2 }, ["bench-1"])).toBe(false);
    expect(weightsAreActive({ "bench-1": Number.NaN }, ["bench-1"])).toBe(false);
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

describe("ranking on the active aggregate (Weighted Average when weights are active)", () => {
  /**
   * Hand-computed weighted ranking fixtures. Selection: bench-1, bench-2.
   *
   * - model-p "P Model"     bench-1 90, bench-2 70
   * - model-q "Q Model"     bench-1 70, bench-2 90
   * - model-s "S Model"     bench-1 90 (sparse: only the double-weightable Benchmark)
   * - model-z "Z Model"     bench-2 60
   *
   * Weights {bench-1: 2, bench-2: 1}: P = 250/3 ≈ 83.33, Q = 230/3 ≈ 76.67,
   * S = 90 (2·90/2 — not penalized for missing bench-2), Z = 60.
   * Weights {bench-1: 1, bench-2: 2}: P = 230/3, Q = 250/3 — P and Q swap.
   */
  const weightedRankingModels: Model[] = [
    makeModel({ id: "model-p", name: "P Model" }),
    makeModel({ id: "model-q", name: "Q Model" }),
    makeModel({ id: "model-s", name: "S Model" }),
    makeModel({ id: "model-z", name: "Z Model" }),
  ];
  const weightedRankingScores: Score[] = [
    makeScore({ modelId: "model-p", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-p", benchmarkId: "bench-2", value: 70 }),
    makeScore({ modelId: "model-q", benchmarkId: "bench-1", value: 70 }),
    makeScore({ modelId: "model-q", benchmarkId: "bench-2", value: 90 }),
    makeScore({ modelId: "model-s", benchmarkId: "bench-1", value: 90 }),
    makeScore({ modelId: "model-z", benchmarkId: "bench-2", value: 60 }),
  ];

  it("ranks by the Weighted Average when weights are active on the selection", () => {
    const ranked = rankModelsByAverage(weightedRankingModels, {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 2, "bench-2": 1 },
    });

    expect(ranked.map((model) => model.id)).toEqual([
      "model-s", // 90 over its only covered Benchmark
      "model-p", // 250/3 ≈ 83.33
      "model-q", // 230/3 ≈ 76.67
      "model-z", // 60
    ]);
  });

  it("swapping the weights reorders the Models", () => {
    const ranked = rankModelsByAverage(weightedRankingModels, {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 1, "bench-2": 2 },
    });

    expect(ranked.map((model) => model.id)).toEqual([
      "model-s", // 90
      "model-q", // 250/3 — now above P
      "model-p", // 230/3
      "model-z", // 60
    ]);
  });

  it("ranks identically to the plain Average when the weights are all default", () => {
    const plain = rankModelsByAverage(weightedRankingModels, {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
    });
    const withDefaults = rankModelsByAverage(weightedRankingModels, {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 1, "bench-2": 1 },
    });
    // A weight on an unselected Benchmark is remembered but inactive.
    const withInactive = rankModelsByAverage(weightedRankingModels, {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-3": 5 },
    });

    expect(withDefaults.map((model) => model.id)).toEqual(plain.map((model) => model.id));
    expect(withInactive.map((model) => model.id)).toEqual(plain.map((model) => model.id));
  });

  it("applies the same tie-break chain and null-aggregate ordering to the Weighted Average", () => {
    // Weights {bench-1: 1, bench-2: 0}: bench-2 is excluded from the
    // aggregate, so the Weighted Average is each Model's bench-1 score while
    // Coverage still counts both Benchmarks.
    //
    // - model-alpha "alpha model" bench-1 90, bench-2 50 → 90, Coverage 2
    // - model-pair  "Pair Model"  bench-1 90, bench-2 70 → 90, Coverage 2
    // - model-solo  "Solo Model"  bench-1 90             → 90, Coverage 1
    // - model-low   "Low Model"   bench-1 70, bench-2 90 → 70
    // - model-excl  "Excluded"    bench-2 90             → null (its only
    //   covered Benchmark carries weight 0) — sorts last, never zero.
    const tieModels: Model[] = [
      makeModel({ id: "model-pair", name: "Pair Model" }),
      makeModel({ id: "model-solo", name: "Solo Model" }),
      makeModel({ id: "model-low", name: "Low Model" }),
      makeModel({ id: "model-excl", name: "Excluded Model" }),
      makeModel({ id: "model-alpha", name: "alpha model" }),
    ];
    const tieScores: Score[] = [
      makeScore({ modelId: "model-pair", benchmarkId: "bench-1", value: 90 }),
      makeScore({ modelId: "model-pair", benchmarkId: "bench-2", value: 70 }),
      makeScore({ modelId: "model-solo", benchmarkId: "bench-1", value: 90 }),
      makeScore({ modelId: "model-low", benchmarkId: "bench-1", value: 70 }),
      makeScore({ modelId: "model-low", benchmarkId: "bench-2", value: 90 }),
      makeScore({ modelId: "model-excl", benchmarkId: "bench-2", value: 90 }),
      makeScore({ modelId: "model-alpha", benchmarkId: "bench-1", value: 90 }),
      makeScore({ modelId: "model-alpha", benchmarkId: "bench-2", value: 50 }),
    ];
    const context = {
      scores: tieScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 1, "bench-2": 0 },
    };

    const ranked = rankModelsByAverage(tieModels, context);
    expect(ranked.map((model) => model.id)).toEqual([
      "model-alpha", // 90, Coverage 2, "alpha model"
      "model-pair", // 90, Coverage 2, "Pair Model" — name after "alpha model"
      "model-solo", // 90, Coverage 1 — loses the tie by lower Coverage
      "model-low", // 70
      "model-excl", // null Weighted Average — last, below every scored Model
    ]);

    // The Average-column sort descending is exactly the ranking, weights
    // included — the identity the leaderboard UI relies on.
    const sorted = sortModelsByColumn(tieModels, { column: "average", direction: "desc" }, context);
    expect(sorted.map((model) => model.id)).toEqual(ranked.map((model) => model.id));
  });

  it("sorts the Average column ascending under weights, null aggregates still last", () => {
    const context = {
      scores: weightedRankingScores,
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 2, "bench-2": 1 },
    };
    const asc = sortModelsByColumn(
      weightedRankingModels,
      { column: "average", direction: "asc" },
      context,
    );

    expect(asc.map((model) => model.id)).toEqual([
      "model-z", // 60
      "model-q", // 230/3
      "model-p", // 250/3
      "model-s", // 90
    ]);
  });

  it("breaks Benchmark-column ties by the weighted ranking chain when weights are active", () => {
    // Sorting by the bench-1 column under weights {bench-1: 1, bench-2: 0}:
    // the 90 ties break by the Weighted Average chain (Coverage, then name),
    // not by the plain Average.
    const tieContext = {
      scores: [
        makeScore({ modelId: "model-pair", benchmarkId: "bench-1", value: 90 }),
        makeScore({ modelId: "model-pair", benchmarkId: "bench-2", value: 70 }),
        makeScore({ modelId: "model-solo", benchmarkId: "bench-1", value: 90 }),
        makeScore({ modelId: "model-low", benchmarkId: "bench-1", value: 70 }),
        makeScore({ modelId: "model-low", benchmarkId: "bench-2", value: 90 }),
        makeScore({ modelId: "model-excl", benchmarkId: "bench-2", value: 90 }),
        makeScore({ modelId: "model-alpha", benchmarkId: "bench-1", value: 90 }),
        makeScore({ modelId: "model-alpha", benchmarkId: "bench-2", value: 50 }),
      ],
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 1, "bench-2": 0 },
    };
    const models = [
      makeModel({ id: "model-pair", name: "Pair Model" }),
      makeModel({ id: "model-solo", name: "Solo Model" }),
      makeModel({ id: "model-low", name: "Low Model" }),
      makeModel({ id: "model-excl", name: "Excluded Model" }),
      makeModel({ id: "model-alpha", name: "alpha model" }),
    ];

    const desc = sortModelsByColumn(models, { column: "bench-1", direction: "desc" }, tieContext);
    expect(desc.map((model) => model.id)).toEqual([
      "model-alpha", // 90 tie → Weighted Average 90, Coverage 2
      "model-pair", // 90 tie → Weighted Average 90, Coverage 2, name after
      "model-solo", // 90 tie → Weighted Average 90, Coverage 1
      "model-low", // 70
      "model-excl", // missing on bench-1 — last, never zero
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

describe("scoresForPair", () => {
  it("splits a pair's Scores into the Primary score and the alternate Evaluation settings", () => {
    const pair = scoresForPair("model-a", "bench-2", scores);

    expect(pair.primary?.value).toBe(90);
    expect(pair.primary?.isPrimary).toBe(true);
    expect(pair.alternates).toHaveLength(1);
    expect(pair.alternates[0]?.value).toBe(70);
    expect(pair.alternates[0]?.isPrimary).toBe(false);
  });

  it("keeps multiple alternate Evaluation settings in data order", () => {
    const withTwoAlternates: Score[] = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 60, isPrimary: false }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 70, isPrimary: false }),
    ];

    const pair = scoresForPair("model-a", "bench-1", withTwoAlternates);

    expect(pair.primary?.value).toBe(80);
    expect(pair.alternates.map((score) => score.value)).toEqual([60, 70]);
  });

  it("returns an empty alternates list when only the Primary score exists", () => {
    const pair = scoresForPair("model-b", "bench-1", scores);

    expect(pair.primary?.value).toBe(95);
    expect(pair.alternates).toEqual([]);
  });

  it("returns no Scores at all for a pair the Model has not been scored on", () => {
    const pair = scoresForPair("model-c", "bench-1", scores);

    expect(pair.primary).toBeUndefined();
    expect(pair.alternates).toEqual([]);
  });

  it("ignores Scores of other Models and Benchmarks", () => {
    const pair = scoresForPair("model-b", "bench-1", scores);

    expect(pair.alternates).toEqual([]);
    expect(scoresForPair("model-a", "bench-9", scores).primary).toBeUndefined();
  });

  describe("against the real Published Results in @llm-bench/data", () => {
    it("resolves claude-opus-4-6 on tau2-bench by the documented Retail rule: the lower Retail Score is Primary", () => {
      // Real pair (impl-04): the Retail domain row 91.89 is Primary even
      // though the Telecom domain row 99.25 is higher — resolution is by the
      // documented rule, never by value.
      const pair = scoresForPair("claude-opus-4-6", "tau2-bench", publishedScores);

      expect(pair.primary?.value).toBe(91.89);
      expect(pair.primary?.evaluationSetting).toBe("pass^1 (Retail domain)");
      expect(pair.alternates.map((score) => score.value)).toEqual([99.25]);
      expect(pair.alternates[0]?.evaluationSetting).toBe("pass^1 (Telecom domain)");
    });

    it("keeps claude-opus-4-5 on swebench-verified on the leaderboard row, not the higher provider rows", () => {
      // Real pair (impl-04): the swebench.com leaderboard row 74.4 is
      // Primary (Canonical sources rank 1) even though both provider
      // self-reported rows are higher.
      const pair = scoresForPair("claude-opus-4-5", "swebench-verified", publishedScores);

      expect(pair.primary?.value).toBe(74.4);
      expect(pair.primary?.sourceType).toBe("leaderboard");
      expect(pair.primary?.sourceUrl).toBe("https://www.swebench.com/");
      expect(pair.alternates.map((score) => score.value)).toEqual([80.9, 80.6]);
    });

    it("is consistent with primaryScoreFor: the Primary score, never an alternate, feeds the leaderboard", () => {
      const pair = scoresForPair("claude-opus-4-6", "tau2-bench", publishedScores);
      const primary = primaryScoreFor("claude-opus-4-6", "tau2-bench", publishedScores);

      expect(primary).toBe(pair.primary);
    });

    it("pins that alternate Evaluation settings are excluded from the Average and best-Score highlighting", () => {
      // The Average over tau2-bench uses the Primary 91.89 — the higher
      // Telecom alternate 99.25 must never be averaged in…
      const { average, coverage, selected } = computeAverage("claude-opus-4-6", publishedScores, {
        benchmarkIds: ["tau2-bench"],
      });
      expect({ average, coverage, selected }).toEqual({ average: 91.89, coverage: 1, selected: 1 });

      // …and best-Score highlighting uses Primary scores only: the best
      // tau2-bench Primary score (91.89) is highlighted, not the 99.25
      // alternate.
      const best = bestValueByBenchmark(publishedScores);
      expect(best.get("tau2-bench")).toBe(91.89);
    });

    it("splits the ARC-AGI-2 reasoning-effort rows for gpt-6-2-astra", () => {
      // Real pair (impl-04): two leaderboard rows under different reasoning
      // efforts — max effort is Primary.
      const pair = scoresForPair("gpt-6-2-astra", "arc-agi-2", publishedScores);

      expect(pair.primary?.value).toBe(95.8);
      expect(pair.primary?.evaluationSetting).toBe("semi-private, max reasoning effort");
      expect(pair.alternates.map((score) => score.value)).toEqual([94.6]);
    });
  });
});
