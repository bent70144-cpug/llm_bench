import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { scores as publishedScores } from "@llm-bench/data";

import {
  bestValueByBenchmark,
  computeAverage,
  defaultSelectedBenchmarkIds,
  filterModels,
  primaryScoreFor,
  primaryScores,
  scoresForPair,
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

  it("sorts by Average with null Averages last and stable ties", () => {
    // Averages: model-a (80+90)/2 = 85, model-b 90, model-c 85, model-d null.
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
