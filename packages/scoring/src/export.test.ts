import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";

import {
  buildFullDatasetExport,
  buildViewExport,
  exportFilename,
  viewExportToCsv,
  type LeaderboardUrlState,
} from "./index";

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

describe("viewExportToCsv", () => {
  it("serializes the view: Model fields, aggregate, Coverage, then per-Benchmark score and provenance columns", () => {
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
      makeScore({
        modelId: "model-b",
        benchmarkId: "bench-2",
        value: 60,
        sourceType: "leaderboard",
        sourceUrl: "https://example.com/leaderboard",
      }),
    ];
    const view = buildViewExport({
      rows: [modelA, modelB],
      benchmarks: [makeBenchmark(), makeBenchmark({ id: "bench-2", name: "Bench 2" })],
      scores,
      state: makeState(),
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    // RFC 4180: CRLF record separators, a final line break, and every
    // missing value as "n/a" — never an empty cell that could read as zero.
    expect(viewExportToCsv(view)).toBe(
      [
        "Model id,Model name,Provider,License,License name,Context window,Release date,Input price / 1M,Output price / 1M,Reference inference provider,Average,Coverage,Bench 1,Bench 1 Source type,Bench 1 source URL,Bench 1 publishedDate,Bench 1 retrievedDate,Bench 2,Bench 2 Source type,Bench 2 source URL,Bench 2 publishedDate,Bench 2 retrievedDate",
        "model-a,Model A,Provider A,proprietary,n/a,128000,2026-01-01,1.5,3,n/a,85,(2/2),80,provider,https://example.com/score,2026-01-01,2026-01-02,90,paper,https://example.com/paper,2026-01-05,2026-01-06",
        "model-b,Model B,Provider A,open-weights,Apache-2.0,128000,2026-01-01,n/a,n/a,Inference Co,60,(1/2),n/a,n/a,n/a,n/a,n/a,60,leaderboard,https://example.com/leaderboard,2026-01-01,2026-01-02",
      ].join("\r\n") + "\r\n",
    );
  });

  it("quotes fields containing commas, quotes, or line breaks per RFC 4180", () => {
    // A Model whose name and License name contain the characters that break
    // naive CSV: commas, double quotes, and a line break. No real Model in
    // the data package has these today; the serializer must still hold.
    const tricky = makeModel({
      id: "model-x",
      name: 'Fancy "Model", Ltd',
      licenseName: "Custom Terms,\nv2",
    });
    const view = buildViewExport({
      rows: [tricky],
      benchmarks: [makeBenchmark({ name: "Bench, One" })],
      scores: [
        makeScore({ modelId: "model-x", benchmarkId: "bench-1", value: 50 }),
      ],
      state: makeState({ benchmarkIds: ["bench-1"] }),
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(viewExportToCsv(view)).toBe(
      [
        'Model id,Model name,Provider,License,License name,Context window,Release date,Input price / 1M,Output price / 1M,Reference inference provider,Average,Coverage,"Bench, One","Bench, One Source type","Bench, One source URL","Bench, One publishedDate","Bench, One retrievedDate"',
        'model-x,"Fancy ""Model"", Ltd",Provider A,proprietary,"Custom Terms,\nv2",128000,2026-01-01,1.5,3,n/a,50,(1/1),50,provider,https://example.com/score,2026-01-01,2026-01-02',
      ].join("\r\n") + "\r\n",
    );
  });

  it("labels and computes the Weighted Average when weights are active on the selection", () => {
    // Model A: 80 on bench-1, 90 on bench-2. Weighting bench-1 ×3 gives
    // (3·80 + 90) / (3 + 1) = 82.5 — hand-computed.
    const view = buildViewExport({
      rows: [makeModel()],
      benchmarks: [makeBenchmark(), makeBenchmark({ id: "bench-2", name: "Bench 2" })],
      scores: [
        makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
        makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
      ],
      state: makeState({ weights: { "bench-1": 3 } }),
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(view.metadata.aggregate).toBe("Weighted Average");
    expect(view.metadata.weights).toEqual({ "bench-1": 3 });
    expect(view.rows[0]!.average).toBe(82.5);
    // The CSV aggregate column carries the Weighted Average label, matching
    // the leaderboard's header at click time.
    expect(viewExportToCsv(view).split("\r\n")[0]).toContain("Weighted Average");
    // Coverage stays unweighted: (2/2), not weighted by the ×3.
    expect(view.rows[0]!.coverage).toEqual({ covered: 2, selected: 2 });
  });

  it("keeps the plain Average label when a remembered weight sits on an unselected Benchmark", () => {
    // The label describes the number actually exported: a weight outside
    // the selection does not change it (weightsAreActive semantics).
    const view = buildViewExport({
      rows: [makeModel()],
      benchmarks: [
        makeBenchmark(),
        makeBenchmark({ id: "bench-2", name: "Bench 2" }),
        makeBenchmark({ id: "bench-3", name: "Bench 3", tier: "extended" }),
      ],
      scores: [
        makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
        makeScore({ modelId: "model-a", benchmarkId: "bench-2", value: 90 }),
      ],
      state: makeState({ weights: { "bench-3": 5 } }),
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(view.metadata.aggregate).toBe("Average");
    expect(view.rows[0]!.average).toBe(85);
  });
});

describe("buildFullDatasetExport", () => {
  it("exports the raw Models, Benchmarks, and every Score — including non-Primary alternate Evaluation settings", () => {
    const models = [makeModel(), makeModel({ id: "model-b", name: "Model B" })];
    const benchmarks = [
      makeBenchmark(),
      makeBenchmark({ id: "bench-2", name: "Bench 2" }),
    ];
    const scores: Score[] = [
      makeScore({ modelId: "model-a", benchmarkId: "bench-1", value: 80 }),
      // Alternate Evaluation setting for the same pair: excluded from every
      // Average and view export, but the dataset export must carry it.
      makeScore({
        modelId: "model-a",
        benchmarkId: "bench-1",
        value: 70,
        evaluationSetting: "0-shot",
        isPrimary: false,
      }),
      makeScore({ modelId: "model-b", benchmarkId: "bench-2", value: 60 }),
    ];

    const exported = buildFullDatasetExport({
      models,
      benchmarks,
      scores,
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(exported).toEqual({
      kind: "llm-bench-dataset",
      formatVersion: 1,
      exportedAt: "2026-11-26T10:30:00.000Z",
      models,
      benchmarks,
      scores,
    });
    expect(exported.scores).toContainEqual(
      expect.objectContaining({ isPrimary: false, evaluationSetting: "0-shot", value: 70 }),
    );
  });
});

describe("exportFilename", () => {
  it("derives dated download filenames from the export kind and timestamp", () => {
    const exportedAt = "2026-11-26T10:30:00.000Z";
    expect(exportFilename("view-csv", exportedAt)).toBe("llm-bench-view-2026-11-26.csv");
    expect(exportFilename("view-json", exportedAt)).toBe("llm-bench-view-2026-11-26.json");
    expect(exportFilename("dataset-json", exportedAt)).toBe("llm-bench-dataset-2026-11-26.json");
  });
});
