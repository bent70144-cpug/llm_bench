import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";

import { buildViewExport, type LeaderboardUrlState } from "./index";

/**
 * Ticket 12: the export builders are pure functions on the scoring seam —
 * they snapshot the current filtered, sorted view (or the full raw dataset)
 * from the data package plus the view state, never from hardcoded columns.
 *
 * Synthetic Published Results for testing only — the @llm-bench/data package
 * never contains fixtures like these.
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

function makeState(overrides: Partial<LeaderboardUrlState> = {}): LeaderboardUrlState {
  return {
    benchmarkIds: ["bench-1", "bench-2"],
    weights: {},
    sort: { column: "average", direction: "desc" },
    search: "",
    licenses: [],
    providers: [],
    comparedModelIds: [],
    ...overrides,
  };
}

describe("buildViewExport", () => {
  it("snapshots the current filtered, sorted view as self-describing JSON", () => {
    const modelA = makeModel();
    const modelB = makeModel({
      id: "model-b",
      name: "Model B",
      license: "open-weights",
      licenseName: "Apache-2.0",
      inputPricePer1M: null,
      outputPricePer1M: null,
      referenceInferenceProvider: "Inference Co",
    });
    const scores: Score[] = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
      makeScore({
        modelId: "model-a",
        benchmarkId: "bench-2",
        value: 90,
        sourceType: "paper",
        sourceUrl: "https://example.com/paper",
        publishedDate: "2026-01-05",
        retrievedDate: "2026-01-06",
      }),
      // Alternate Evaluation setting for the same pair: never part of the export.
      makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 70, isPrimary: false }),
      makeScore({
        modelId: "model-b",
        benchmarkId: "bench-2",
        value: 60,
        sourceType: "leaderboard",
        sourceUrl: "https://example.com/leaderboard",
      }),
    ];

    const view = buildViewExport({
      // The rows arrive already filtered and sorted by the leaderboard —
      // the export must keep exactly this order and membership.
      rows: [modelA, modelB],
      benchmarks: [makeBenchmark(), makeBenchmark({ id: "bench-2", name: "Bench 2" })],
      scores,
      state: makeState(),
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(view.metadata).toEqual({
      kind: "llm-bench-view",
      formatVersion: 1,
      exportedAt: "2026-11-26T10:30:00.000Z",
      aggregate: "Average",
      selectedBenchmarks: [
        { id: "bench-1", name: "Bench 1" },
        { id: "bench-2", name: "Bench 2" },
      ],
      weights: {},
      sort: { column: "average", direction: "desc" },
      filters: {
        search: "",
        licenses: [],
        providers: [],
        minContextWindow: null,
        maxInputPricePer1M: null,
        maxOutputPricePer1M: null,
      },
      rowCount: 2,
    });

    expect(view.rows).toEqual([
      {
        model: {
          id: "model-a",
          name: "Model A",
          provider: "Provider A",
          license: "proprietary",
          licenseName: null,
          releaseDate: "2026-01-01",
          contextWindow: 128000,
          inputPricePer1M: 1.5,
          outputPricePer1M: 3,
          referenceInferenceProvider: null,
        },
        average: 85,
        coverage: { covered: 2, selected: 2 },
        scores: {
          "bench-1": {
            value: 80,
            evaluationSetting: "5-shot",
            sourceType: "provider",
            sourceUrl: "https://example.com/score",
            publishedDate: "2026-01-01",
            retrievedDate: "2026-01-02",
            verified: true,
            isPrimary: true,
          },
          "bench-2": {
            value: 90,
            evaluationSetting: "5-shot",
            sourceType: "paper",
            sourceUrl: "https://example.com/paper",
            publishedDate: "2026-01-05",
            retrievedDate: "2026-01-06",
            verified: true,
            isPrimary: true,
          },
        },
      },
      {
        model: {
          id: "model-b",
          name: "Model B",
          provider: "Provider A",
          license: "open-weights",
          licenseName: "Apache-2.0",
          releaseDate: "2026-01-01",
          contextWindow: 128000,
          inputPricePer1M: null,
          outputPricePer1M: null,
          referenceInferenceProvider: "Inference Co",
        },
        average: 60,
        coverage: { covered: 1, selected: 2 },
        scores: {
          "bench-1": null,
          "bench-2": {
            value: 60,
            evaluationSetting: "5-shot",
            sourceType: "leaderboard",
            sourceUrl: "https://example.com/leaderboard",
            publishedDate: "2026-01-01",
            retrievedDate: "2026-01-02",
            verified: true,
            isPrimary: true,
          },
        },
      },
    ]);
  });

  it("records the active filters and selection in the metadata block", () => {
    const model = makeModel();
    const view = buildViewExport({
      rows: [model],
      benchmarks: [
        makeBenchmark(),
        makeBenchmark({ id: "bench-2", name: "Bench 2" }),
        makeBenchmark({ id: "bench-3", name: "Bench 3", tier: "extended" }),
      ],
      scores: [makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 })],
      state: makeState({
        benchmarkIds: ["bench-1"],
        sort: { column: "provider", direction: "asc" },
        search: "model",
        licenses: ["proprietary"],
        providers: ["Provider A"],
        minContextWindow: 100000,
        maxInputPricePer1M: 2,
        maxOutputPricePer1M: 4,
      }),
      exportedAt: "2026-11-26T00:00:00.000Z",
    });

    expect(view.metadata.selectedBenchmarks).toEqual([{ id: "bench-1", name: "Bench 1" }]);
    expect(view.metadata.sort).toEqual({ column: "provider", direction: "asc" });
    expect(view.metadata.filters).toEqual({
      search: "model",
      licenses: ["proprietary"],
      providers: ["Provider A"],
      minContextWindow: 100000,
      maxInputPricePer1M: 2,
      maxOutputPricePer1M: 4,
    });
    expect(view.metadata.rowCount).toBe(1);
    // Columns follow the selection: bench-2 is not a column, so no key for it.
    expect(Object.keys(view.rows[0]!.scores)).toEqual(["bench-1"]);
  });
});
