import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import {
  benchmarks as publishedBenchmarks,
  models as publishedModels,
  pricingConfig as publishedPricingConfig,
  scores as publishedScores,
} from "@llm-bench/data";

import {
  activeAggregateResult,
  bestValueByBenchmark,
  blendedPricePer1M,
  computeAverage,
  computeWeightedAverage,
  decodeLeaderboardUrlState,
  DEFAULT_LEADERBOARD_SORT,
  defaultSelectedBenchmarkIds,
  encodeLeaderboardUrlState,
  filterModels,
  formatCoverage,
  isUnderHalfCoverage,
  modelDataCurrency,
  primaryScoreFor,
  primaryScores,
  rankModelsByAverage,
  scoresForPair,
  selectRadarBenchmarks,
  selectedBenchmarks,
  sortModelsByColumn,
  weightsAreActive,
  type LeaderboardUrlState,
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

describe("selectRadarBenchmarks", () => {
  /** A nine-Benchmark catalogue: bench-1 … bench-9, catalogue order. */
  const catalogue = Array.from({ length: 9 }, (_, index) =>
    makeBenchmark({ id: `bench-${index + 1}` }),
  );

  it("keeps the whole selection when it fits under the cap, ties in catalogue order", () => {
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-2" })];
    const scores = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
    ];

    // Both Benchmarks are covered by the one compared Model; the selection
    // fits under the cap, so everything stays, in catalogue order.
    expect(selectRadarBenchmarks(selection, ["model-a"], scores)).toEqual({
      benchmarkIds: ["bench-1", "bench-2"],
      deprioritizedBenchmarkIds: [],
    });
  });

  it("prioritizes Benchmarks with Primary scores across more compared Models", () => {
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-2" })];
    const scores = [
      // Both compared Models have a Primary score on bench-2; only one on bench-1.
      makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
      makeScore({ modelId: "model-b", benchmarkId: "bench-2", value: 70 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
    ];

    expect(selectRadarBenchmarks(selection, ["model-a", "model-b"], scores).benchmarkIds).toEqual([
      "bench-2",
      "bench-1",
    ]);
  });

  it("breaks coverage ties in catalogue order", () => {
    // The selection arrives in catalogue order (as selectedBenchmarks
    // returns it); equal coverage must keep that order.
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-3" })];
    const scores = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-3", value: 60 }),
    ];

    expect(selectRadarBenchmarks(selection, ["model-a"], scores).benchmarkIds).toEqual([
      "bench-1",
      "bench-3",
    ]);
  });

  it("caps at 8 axes and reports the deprioritized Benchmarks in catalogue order", () => {
    const scores = [
      // bench-1, 2, 5, 7: covered by both compared Models.
      ...["bench-1", "bench-2", "bench-5", "bench-7"].flatMap((benchmarkId) => [
        makeScore({ modelId: "model-a", benchmarkId, value: 80 }),
        makeScore({ modelId: "model-b", benchmarkId, value: 70 }),
      ]),
      // bench-3, 4, 8: covered by one compared Model.
      ...["bench-3", "bench-4", "bench-8"].map((benchmarkId) =>
        makeScore({ modelId: "model-a", benchmarkId, value: 60 }),
      ),
      // bench-6: covered by no compared Model. bench-9: also one covered Model.
      makeScore({ modelId: "model-b", benchmarkId: "bench-9", value: 50 }),
    ];

    const radar = selectRadarBenchmarks(catalogue, ["model-a", "model-b"], scores);

    // Coverage 2 first (catalogue order), then coverage 1 (catalogue order);
    // the uncovered bench-6 is the one axis the cap drops.
    expect(radar.benchmarkIds).toEqual([
      "bench-1",
      "bench-2",
      "bench-5",
      "bench-7",
      "bench-3",
      "bench-4",
      "bench-8",
      "bench-9",
    ]);
    expect(radar.deprioritizedBenchmarkIds).toEqual(["bench-6"]);
  });

  it("cuts within a coverage tie by catalogue order when the cap bites", () => {
    // Nine equally covered Benchmarks: the cap keeps the first eight in
    // catalogue order and deprioritizes the ninth.
    const scores = catalogue.flatMap((benchmark) => [
      makeScore({ modelId: "model-a", benchmarkId: benchmark.id, value: 80 }),
      makeScore({ modelId: "model-b", benchmarkId: benchmark.id, value: 70 }),
    ]);

    const radar = selectRadarBenchmarks(catalogue, ["model-a", "model-b"], scores);
    expect(radar.benchmarkIds).toEqual(["bench-1", "bench-2", "bench-3", "bench-4", "bench-5", "bench-6", "bench-7", "bench-8"]);
    expect(radar.deprioritizedBenchmarkIds).toEqual(["bench-9"]);
  });

  it("counts only Primary scores of the compared Models", () => {
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-2" })];
    const scores = [
      // An alternate Evaluation setting never counts, whoever it belongs to.
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 99, isPrimary: false }),
      makeScore({ modelId: "model-b", benchmarkId: "bench-1", value: 99, isPrimary: false }),
      // Scores of Models that are not being compared never count either.
      makeScore({ modelId: "model-z", benchmarkId: "bench-1", value: 95 }),
      makeScore({ modelId: "model-z", benchmarkId: "bench-2", value: 95 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 60 }),
    ];

    expect(selectRadarBenchmarks(selection, ["model-a", "model-b"], scores).benchmarkIds).toEqual([
      "bench-2",
      "bench-1",
    ]);
  });

  it("counts a duplicated compared Model id once", () => {
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-2" })];
    const scores = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
      makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
    ];

    // "model-a" twice must not double bench-1's coverage to 2.
    expect(
      selectRadarBenchmarks(selection, ["model-a", "model-a"], scores).benchmarkIds,
    ).toEqual(["bench-1", "bench-2"]);
  });

  it("honors a custom cap, including cap 0", () => {
    const selection = [makeBenchmark({ id: "bench-1" }), makeBenchmark({ id: "bench-2" })];
    const scores = [makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 })];

    expect(selectRadarBenchmarks(selection, ["model-a"], scores, 1)).toEqual({
      benchmarkIds: ["bench-2"],
      deprioritizedBenchmarkIds: ["bench-1"],
    });
    expect(selectRadarBenchmarks(selection, ["model-a"], scores, 0)).toEqual({
      benchmarkIds: [],
      deprioritizedBenchmarkIds: ["bench-1", "bench-2"],
    });
  });

  it("returns empty axes for an empty selection", () => {
    expect(selectRadarBenchmarks([], ["model-a"], [])).toEqual({
      benchmarkIds: [],
      deprioritizedBenchmarkIds: [],
    });
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

describe("modelDataCurrency", () => {
  it("returns the Model's lastUpdated when it is later than every Score's retrievedDate", () => {
    // model-a's lastUpdated is 2026-02-01; its Scores were retrieved 2026-01-02.
    expect(modelDataCurrency(makeModel(), scores)).toBe("2026-02-01");
  });

  it("returns the latest retrievedDate when a Score was fetched after the metadata update", () => {
    const model = makeModel({ id: "model-x", lastUpdated: "2026-03-01" });
    const fetched: Score[] = [
      makeScore({ modelId: "model-x", retrievedDate: "2026-02-01" }),
      makeScore({ modelId: "model-x", retrievedDate: "2026-03-15" }),
    ];

    expect(modelDataCurrency(model, fetched)).toBe("2026-03-15");
  });

  it("uses every Score of the Model — alternate Evaluation settings too", () => {
    const model = makeModel({ id: "model-y", lastUpdated: "2026-03-01" });
    const fetched: Score[] = [
      makeScore({ modelId: "model-y", retrievedDate: "2026-02-01" }),
      // An alternate Evaluation setting fetched later than the Primary score.
      makeScore({ modelId: "model-y", retrievedDate: "2026-03-02", isPrimary: false }),
    ];

    expect(modelDataCurrency(model, fetched)).toBe("2026-03-02");
  });

  it("ignores Scores of other Models", () => {
    const model = makeModel({ id: "model-z", lastUpdated: "2026-03-01" });
    const others: Score[] = [makeScore({ modelId: "other", retrievedDate: "2026-12-31" })];

    expect(modelDataCurrency(model, others)).toBe("2026-03-01");
  });

  it("returns lastUpdated for a Model with no Scores", () => {
    expect(modelDataCurrency(makeModel({ lastUpdated: "2026-05-05" }), [])).toBe("2026-05-05");
  });

  describe("against the real Published Results in @llm-bench/data", () => {
    it("every real Model's data currency is the 2026-11-26 dataset snapshot date", () => {
      // Every real Score was retrieved 2026-11-26 and every Model's
      // lastUpdated is 2026-11-26, so each Model page header reads that
      // date — the page can never look fresher than its oldest source.
      for (const model of publishedModels) {
        expect(modelDataCurrency(model, publishedScores)).toBe("2026-11-26");
      }
      expect(publishedModels).toHaveLength(26);
    });
  });
});

describe("leaderboard URL state (encode/decode)", () => {
  // A miniature catalogue: bench-1 and bench-2 are core-Tier (the default
  // selection), bench-3 is extended.
  const catalogue: Benchmark[] = [
    makeBenchmark({ id: "bench-1", name: "Bench 1" }),
    makeBenchmark({ id: "bench-2", name: "Bench 2" }),
    makeBenchmark({ id: "bench-3", name: "Bench 3", tier: "extended" }),
  ];

  it("encodes a full view into the documented compact, human-readable format", () => {
    const query = encodeLeaderboardUrlState({
      benchmarkIds: ["bench-1", "bench-2"],
      weights: { "bench-1": 2 },
      sort: DEFAULT_LEADERBOARD_SORT,
      search: "gpt 5",
      licenses: ["proprietary"],
      providers: ["OpenAI"],
      minContextWindow: 500000,
      maxInputPricePer1M: undefined,
      maxOutputPricePer1M: undefined,
      comparedModelIds: ["model-a", "model-b"],
    });

    // Fixed parameter order; default sort omitted; default weights omitted;
    // commas and colons stay readable.
    expect(query).toBe(
      "benchmarks=bench-1,bench-2&weights=bench-1:2&q=gpt+5&license=proprietary" +
        "&provider=OpenAI&min-context=500000&compare=model-a,model-b",
    );
  });

  it("encodes the price ceilings and a non-default sort", () => {
    const query = encodeLeaderboardUrlState({
      benchmarkIds: ["bench-3"],
      weights: {},
      sort: { column: "bench-3", direction: "asc" },
      search: "",
      licenses: [],
      providers: [],
      minContextWindow: undefined,
      maxInputPricePer1M: 4.5,
      maxOutputPricePer1M: 10,
      comparedModelIds: [],
    });

    expect(query).toBe(
      "benchmarks=bench-3&sort=bench-3:asc&max-input-price=4.5&max-output-price=10",
    );
  });

  it("always encodes the selection explicitly — an empty selection is benchmarks=", () => {
    const query = encodeLeaderboardUrlState({
      benchmarkIds: [],
      weights: {},
      sort: DEFAULT_LEADERBOARD_SORT,
      search: "",
      licenses: [],
      providers: [],
      comparedModelIds: [],
    });

    expect(query).toBe("benchmarks=");
  });

  it("decodes the documented format back into the same state", () => {
    const state = decodeLeaderboardUrlState(
      "benchmarks=bench-2,bench-1&weights=bench-2:0.5&q=gpt+5&license=proprietary,open-weights" +
        "&provider=Mistral+AI,OpenAI&min-context=500000&max-input-price=4.5&compare=model-a,model-b",
      catalogue,
    );

    expect(state).toEqual({
      benchmarkIds: ["bench-2", "bench-1"],
      weights: { "bench-2": 0.5 },
      sort: DEFAULT_LEADERBOARD_SORT,
      search: "gpt 5",
      licenses: ["proprietary", "open-weights"],
      providers: ["Mistral AI", "OpenAI"],
      minContextWindow: 500000,
      maxInputPricePer1M: 4.5,
      maxOutputPricePer1M: undefined,
      comparedModelIds: ["model-a", "model-b"],
    });
  });

  it("decodes a sort on a Benchmark column and accepts a leading '?'", () => {
    const state = decodeLeaderboardUrlState("?sort=bench-3:asc", catalogue);

    expect(state.sort).toEqual({ column: "bench-3", direction: "asc" });
    // No benchmarks parameter: the Tier-driven default selection.
    expect(state.benchmarkIds).toEqual(["bench-1", "bench-2"]);
  });

  it("treats benchmarks= as an explicit empty selection, distinct from an absent parameter", () => {
    // Absent → the core-Tier default; present but all-unknown → dropped to
    // an explicit empty selection (the visitor chose Benchmarks that no
    // longer exist — the view is honest about that, it does not silently
    // re-select the defaults).
    expect(decodeLeaderboardUrlState("", catalogue).benchmarkIds).toEqual(["bench-1", "bench-2"]);
    expect(decodeLeaderboardUrlState("benchmarks=", catalogue).benchmarkIds).toEqual([]);
    expect(decodeLeaderboardUrlState("benchmarks=ghost", catalogue).benchmarkIds).toEqual([]);
  });

  it("round-trips representative views exactly: decode(encode(state)) == state", () => {
    const states: LeaderboardUrlState[] = [
      // The default view: core selection, no weights, default sort.
      {
        benchmarkIds: ["bench-1", "bench-2"],
        weights: {},
        sort: DEFAULT_LEADERBOARD_SORT,
        search: "",
        licenses: [],
        providers: [],
        comparedModelIds: [],
      },
      // Everything at once: weights (including 0 and a remembered weight on
      // an unselected Benchmark), a Benchmark-column sort, search text with
      // URL-significant characters, both price ceilings, compared Models.
      {
        benchmarkIds: ["bench-1", "bench-3"],
        weights: { "bench-1": 0, "bench-2": 3, "bench-3": 0.5 },
        sort: { column: "bench-1", direction: "asc" },
        search: "gpt & 5 =? #2",
        licenses: ["open-weights", "open-source"],
        providers: ["Mistral AI", "Z.ai"],
        minContextWindow: 0,
        maxInputPricePer1M: 4.5,
        maxOutputPricePer1M: 10,
        comparedModelIds: ["model-a", "model-b", "model-c"],
      },
      // An empty selection round-trips as benchmarks= — the shared URL keeps
      // meaning "no Benchmark selected".
      {
        benchmarkIds: [],
        weights: { "bench-1": 2 },
        sort: { column: "provider", direction: "desc" },
        search: "  ",
        licenses: [],
        providers: [],
        comparedModelIds: [],
      },
    ];

    for (const state of states) {
      expect(decodeLeaderboardUrlState(encodeLeaderboardUrlState(state), catalogue)).toEqual(state);
    }
  });

  it("ignores unknown parameters and malformed values — no throw, defaults win", () => {
    const state = decodeLeaderboardUrlState(
      "?foo=bar&benchmarks=ghost,bench-1,bench-1&weights=ghost:2,bench-2:abc,bench-1:-3,bench-2:0.5,bench-3:1" +
        "&sort=nonsense:desc&sort=average:sideways&q=&license=proprietary,banana&min-context=-5" +
        "&max-input-price=nan&compare=,,&%zz=broke",
      catalogue,
    );

    expect(state.benchmarkIds).toEqual(["bench-1"]); // unknown dropped, duplicate collapsed
    expect(state.weights).toEqual({ "bench-2": 0.5 }); // unknown id, garbage number, negative, and default 1 all dropped
    expect(state.sort).toEqual(DEFAULT_LEADERBOARD_SORT); // unknown column and bad direction
    expect(state.search).toBe("");
    expect(state.licenses).toEqual(["proprietary"]); // value outside the three-value License enum
    expect(state.minContextWindow).toBeUndefined(); // negative
    expect(state.maxInputPricePer1M).toBeUndefined(); // not a number
    expect(state.comparedModelIds).toEqual([]); // empty entries dropped
  });

  it("keeps the first occurrence when a parameter repeats", () => {
    const state = decodeLeaderboardUrlState(
      "?benchmarks=bench-1&benchmarks=bench-3&q=first&q=second",
      catalogue,
    );

    expect(state.benchmarkIds).toEqual(["bench-1"]);
    expect(state.search).toBe("first");
  });

  it("drops decoded benchmark ids that no longer exist in the catalogue", () => {
    // A shared URL from before a Benchmark was retired: the selection keeps
    // the Benchmarks that still exist; a weight on a retired Benchmark is
    // dropped with it; sorting by a retired Benchmark falls back to the
    // default sort.
    const state = decodeLeaderboardUrlState(
      "benchmarks=bench-1,retired-bench&weights=retired-bench:2,bench-1:3&sort=retired-bench:desc",
      catalogue,
    );

    expect(state.benchmarkIds).toEqual(["bench-1"]);
    expect(state.weights).toEqual({ "bench-1": 3 });
    expect(state.sort).toEqual(DEFAULT_LEADERBOARD_SORT);
  });

  it("keeps Provider and compared-Model ids verbatim — stale names filter to no Models rather than being silently dropped", () => {
    // Providers and Models cannot be validated against the Benchmark
    // catalogue; a stale name in a shared URL restores the view exactly,
    // and "No Models match the current search and filters" is the honest
    // rendering of a filter for something that no longer exists.
    const state = decodeLeaderboardUrlState(
      "provider=Former+Labs&compare=retired-model,still-here",
      catalogue,
    );

    expect(state.providers).toEqual(["Former Labs"]);
    expect(state.comparedModelIds).toEqual(["retired-model", "still-here"]);
  });
});

describe("blendedPricePer1M", () => {
  // The published ratio (packages/data/pricing-config.json) is 3:1, and the
  // divisor is the weight sum (3 + 1 = 4), never stored: a Model priced
  // 3 in / 15 out blends to (3·3 + 1·15)/4 = 24/4 = 6.
  const threeToOne = { inputWeight: 3, outputWeight: 1 };

  it("computes (inputWeight·input + outputWeight·output) / (inputWeight + outputWeight) for the 3:1 config", () => {
    // Hand-computed: (3·3 + 1·15)/4 = 6.
    expect(blendedPricePer1M(makeModel({ inputPricePer1M: 3, outputPricePer1M: 15 }), threeToOne)).toBe(6);
    // Fractional prices: (3·0.5 + 1·2.5)/4 = 4/4 = 1.
    expect(blendedPricePer1M(makeModel({ inputPricePer1M: 0.5, outputPricePer1M: 2.5 }), threeToOne)).toBe(1);
    // The fixture defaults (1.5 in / 3 out): (4.5 + 3)/4 = 1.875.
    expect(blendedPricePer1M(makeModel(), threeToOne)).toBe(1.875);
  });

  it("returns null when either price is null — never a made-up number", () => {
    // The price invariant (both present or both null) makes the first case
    // the real one; a half-null record is still null, never zero.
    expect(
      blendedPricePer1M(
        makeModel({ inputPricePer1M: null, outputPricePer1M: null }),
        threeToOne,
      ),
    ).toBeNull();
    expect(
      blendedPricePer1M(makeModel({ inputPricePer1M: 3, outputPricePer1M: null }), threeToOne),
    ).toBeNull();
    expect(
      blendedPricePer1M(makeModel({ inputPricePer1M: null, outputPricePer1M: 15 }), threeToOne),
    ).toBeNull();
  });

  it("takes the ratio from the pricing config data, not from code", () => {
    const model = makeModel({ inputPricePer1M: 3, outputPricePer1M: 15 });

    // A different methodology is a data change: 1:1 → (3 + 15)/2 = 9.
    expect(blendedPricePer1M(model, { inputWeight: 1, outputWeight: 1 })).toBe(9);
    // Output-heavy: 1:3 → (3 + 3·15)/4 = 48/4 = 12.
    expect(blendedPricePer1M(model, { inputWeight: 1, outputWeight: 3 })).toBe(12);
    // Equal weights of any size agree: 2:2 → (2·3 + 2·15)/4 = 9, and the
    // divisor is the weight sum: 0.5:0.5 → (1.5 + 7.5)/1 = 9.
    expect(blendedPricePer1M(model, { inputWeight: 2, outputWeight: 2 })).toBe(9);
    expect(blendedPricePer1M(model, { inputWeight: 0.5, outputWeight: 0.5 })).toBe(9);
  });

  it("reads the published 3:1 config over the real Models", () => {
    expect(publishedPricingConfig).toEqual({ inputWeight: 3, outputWeight: 1 });

    // Hand-computed from models.json: Kimi K3 (3 in / 15 out) → 6;
    // Claude Opus 4.6 (5 / 25) → 10; Kimi K2.5 (0.5 / 2.5) → 1;
    // GPT-6.2 Astra (8 / 40) → 16.
    const byId = (id: string): Model => publishedModels.find((model) => model.id === id)!;
    expect(blendedPricePer1M(byId("kimi-k3"), publishedPricingConfig)).toBe(6);
    expect(blendedPricePer1M(byId("claude-opus-4-6"), publishedPricingConfig)).toBe(10);
    expect(blendedPricePer1M(byId("kimi-k2-5"), publishedPricingConfig)).toBe(1);
    expect(blendedPricePer1M(byId("gpt-6-2-astra"), publishedPricingConfig)).toBe(16);

    // Every null-priced Model in the real dataset blends to null — the
    // Models the price chart lists as "Self-hosted / no public API rate".
    const nullPriced = publishedModels.filter((model) => model.inputPricePer1M === null);
    expect(nullPriced.map((model) => model.id)).toEqual([
      "gemini-3-pro",
      "deepseek-v4-pro",
      "deepseek-v4-pro-base",
      "deepseek-v4-1-flash",
      "minimax-m2",
      "llama-4-maverick",
      "llama-4-maverick-base",
      "kimi-k2-thinking",
    ]);
    for (const model of nullPriced) {
      expect(blendedPricePer1M(model, publishedPricingConfig)).toBeNull();
    }
  });
});

describe("activeAggregateResult", () => {
  // Two Models whose plain and weighted aggregates differ, over the shared
  // two-Benchmark fixture (bench-1, bench-2).
  const contextScores: Score[] = [
    makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
    makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
  ];

  it("returns the plain Average when no weights are given", () => {
    expect(activeAggregateResult("model-a", { scores: contextScores, benchmarkIds: ["bench-1", "bench-2"] })).toEqual(
      computeAverage("model-a", contextScores, { benchmarkIds: ["bench-1", "bench-2"] }),
    );
  });

  it("returns the Weighted Average exactly when the weights are active on the selection", () => {
    const weights = { "bench-1": 3 };
    const context = { scores: contextScores, benchmarkIds: ["bench-1", "bench-2"], weights };

    // Hand-computed: (3·80 + 1·90)/(3 + 1) = 330/4 = 82.5.
    expect(activeAggregateResult("model-a", context)).toEqual({
      average: 82.5,
      coverage: 2,
      selected: 2,
    });
    expect(activeAggregateResult("model-a", context)).toEqual(
      computeWeightedAverage("model-a", contextScores, {
        benchmarkIds: ["bench-1", "bench-2"],
        weights,
      }),
    );
  });

  it("keeps the plain Average when the weights are present but inactive (default 1, or off-selection)", () => {
    // An explicit default weight of 1 is not active …
    expect(
      activeAggregateResult("model-a", {
        scores: contextScores,
        benchmarkIds: ["bench-1", "bench-2"],
        weights: { "bench-1": 1, "bench-2": 1 },
      }),
    ).toEqual({ average: 85, coverage: 2, selected: 2 });
    // … and neither is a non-default weight on a Benchmark outside the selection.
    expect(
      activeAggregateResult("model-a", {
        scores: contextScores,
        benchmarkIds: ["bench-1", "bench-2"],
        weights: { "bench-9": 4 },
      }),
    ).toEqual({ average: 85, coverage: 2, selected: 2 });
  });
});

describe("Weighted Average against the real Published Results in @llm-bench/data", () => {
  // Real pair (impl-04 data): over the default 12 core Benchmarks,
  // Claude Opus 4.6 covers gpqa-diamond 91.31, aime-2025 99.79,
  // tau2-bench 91.89, swebench-verified 75.6 → plain Average 358.59/4 =
  // 89.6475. Claude Sonnet 4.6 covers swebench-verified 79.6,
  // gpqa-diamond 89.9, aime-2025 95.6, tau2-bench 91.7 → 356.8/4 = 89.2.
  // Opus leads. Weighting SWE-bench Verified ×2: Opus
  // (91.31 + 99.79 + 91.89 + 2·75.6)/5 = 434.19/5 = 86.838; Sonnet
  // (89.9 + 95.6 + 91.7 + 2·79.6)/5 = 436.4/5 = 87.28 — Sonnet overtakes.
  const coreSelection = defaultSelectedBenchmarkIds(publishedBenchmarks);
  const context = { scores: publishedScores, benchmarkIds: coreSelection };

  it("reorders Claude Opus 4.6 and Claude Sonnet 4.6 when SWE-bench Verified counts double", () => {
    const plain = rankModelsByAverage(publishedModels, context);
    expect(plain.indexOf(publishedModels.find((m) => m.id === "claude-opus-4-6")!)).toBeLessThan(
      plain.indexOf(publishedModels.find((m) => m.id === "claude-sonnet-4-6")!),
    );

    const weighted = rankModelsByAverage(publishedModels, {
      ...context,
      weights: { "swebench-verified": 2 },
    });
    expect(
      weighted.indexOf(publishedModels.find((m) => m.id === "claude-sonnet-4-6")!),
    ).toBeLessThan(weighted.indexOf(publishedModels.find((m) => m.id === "claude-opus-4-6")!));
  });

  it("computes the hand-computed Weighted Averages for the pair", () => {
    const opus = computeWeightedAverage("claude-opus-4-6", publishedScores, {
      benchmarkIds: coreSelection,
      weights: { "swebench-verified": 2 },
    });
    const sonnet = computeWeightedAverage("claude-sonnet-4-6", publishedScores, {
      benchmarkIds: coreSelection,
      weights: { "swebench-verified": 2 },
    });

    expect(opus.average).toBeCloseTo(86.838, 3);
    expect(sonnet.average).toBeCloseTo(87.28, 3);
    // Coverage is unweighted: still 4 of the 12 selected Benchmarks each.
    expect(formatCoverage(opus)).toBe("(4/12)");
    expect(formatCoverage(sonnet)).toBe("(4/12)");
  });

  it("encodes the shared URL for that weighted view and decodes it back exactly", () => {
    // The URL a visitor shares after weighting SWE-bench Verified ×2 over
    // the default core selection: only the non-default weight appears.
    const query = encodeLeaderboardUrlState({
      benchmarkIds: coreSelection,
      weights: { "swebench-verified": 2 },
      sort: DEFAULT_LEADERBOARD_SORT,
      search: "",
      licenses: [],
      providers: [],
      comparedModelIds: [],
    });
    expect(query).toBe(
      "benchmarks=mmlu-pro,mmlu,gpqa-diamond,bbh,math-500,aime-2025,humaneval,livecodebench," +
        "swebench-verified,tau2-bench,ifeval,hellaswag&weights=swebench-verified:2",
    );

    expect(decodeLeaderboardUrlState(query, publishedBenchmarks)).toEqual({
      benchmarkIds: coreSelection,
      weights: { "swebench-verified": 2 },
      sort: DEFAULT_LEADERBOARD_SORT,
      search: "",
      licenses: [],
      providers: [],
      minContextWindow: undefined,
      maxInputPricePer1M: undefined,
      maxOutputPricePer1M: undefined,
      comparedModelIds: [],
    });
  });
});
