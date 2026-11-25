import type { Score } from "@llm-bench/schema";

/**
 * @llm-bench/scoring — pure functions, no React.
 *
 * Averages and rankings are computed at read time from Published Results
 * and are never stored in the data package. Only the Primary score per
 * Model and Benchmark feeds the Average, Coverage, and highlighting.
 *
 * The public API is designed to grow without breaking changes: later
 * tickets add Weighted Average, ranking, filtering, and URL-state
 * encode/decode as new functions or as optional fields on the existing
 * options objects.
 */

/** Options for computing an Average over a Benchmark selection. */
export interface AverageOptions {
  /** Ids of the selected Benchmarks. Order does not matter; duplicates are ignored. */
  benchmarkIds: readonly string[];
}

/** The Average of one Model over a Benchmark selection, with its Coverage. */
export interface AverageResult {
  /**
   * Arithmetic mean of the selected Benchmarks for which the Model has a
   * Primary score. Null when Coverage is 0 — never zero.
   */
  average: number | null;
  /** Number of selected Benchmarks for which the Model has a Primary score. */
  coverage: number;
  /** Number of distinct selected Benchmarks. */
  selected: number;
}

/**
 * Computes the Average and Coverage of one Model over a selection of
 * Benchmarks, using Primary scores only.
 */
export function computeAverage(
  modelId: string,
  scores: readonly Score[],
  options: AverageOptions,
): AverageResult {
  const selected = new Set(options.benchmarkIds);
  const primaryScoresForModel = scores.filter(
    (score) => score.isPrimary && score.modelId === modelId && selected.has(score.benchmarkId),
  );

  if (primaryScoresForModel.length === 0) {
    return { average: null, coverage: 0, selected: selected.size };
  }

  const total = primaryScoresForModel.reduce((sum, score) => sum + score.value, 0);
  return {
    average: total / primaryScoresForModel.length,
    coverage: primaryScoresForModel.length,
    selected: selected.size,
  };
}

/**
 * Returns only the Primary scores — the single Score per Model and
 * Benchmark used for Averages, highlighting, and charts.
 */
export function primaryScores(scores: readonly Score[]): Score[] {
  return scores.filter((score) => score.isPrimary);
}

/**
 * Returns the Primary score for one Model and Benchmark pair, or undefined
 * when the Model has no Primary score for it (rendered as "n/a", never 0).
 */
export function primaryScoreFor(
  modelId: string,
  benchmarkId: string,
  scores: readonly Score[],
): Score | undefined {
  return scores.find(
    (score) => score.isPrimary && score.modelId === modelId && score.benchmarkId === benchmarkId,
  );
}

/**
 * Maps each Benchmark id to the best Primary score value across all Models,
 * for highlighting the best Score per Benchmark. Non-primary Scores are
 * ignored; Benchmarks without a Primary score have no entry.
 */
export function bestValueByBenchmark(scores: readonly Score[]): ReadonlyMap<string, number> {
  const best = new Map<string, number>();
  for (const score of scores) {
    if (!score.isPrimary) continue;
    const current = best.get(score.benchmarkId);
    if (current === undefined || score.value > current) {
      best.set(score.benchmarkId, score.value);
    }
  }
  return best;
}
