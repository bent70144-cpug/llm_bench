import { describe, expect, it } from "vitest";
import type { Score } from "@llm-bench/schema";

import { bestValueByBenchmark, computeAverage, primaryScoreFor, primaryScores } from "./index";

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
