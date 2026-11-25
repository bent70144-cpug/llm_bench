import type { Benchmark, License, Model, Score } from "@llm-bench/schema";

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
 * The Coverage display form "(n/selected)": every Average is shown with
 * its Coverage count against the number of selected Benchmarks.
 */
export function formatCoverage(result: AverageResult): string {
  return `(${result.coverage}/${result.selected})`;
}

/**
 * Whether a Model's Coverage is strictly under 50% of the selected
 * Benchmarks — the condition for the "Under 50% Coverage" badge. Exactly
 * 50% is NOT under and is never badged; with no Benchmark selected there
 * is no Coverage to be under, so it is false as well.
 */
export function isUnderHalfCoverage(result: AverageResult): boolean {
  if (result.selected <= 0) return false;
  return 2 * result.coverage < result.selected;
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

/**
 * The default Benchmark selection: the ids of the core-Tier Benchmarks, in
 * catalogue order. Tier drives the default directly, so the web app never
 * hardcodes a selection.
 */
export function defaultSelectedBenchmarkIds(benchmarks: readonly Benchmark[]): string[] {
  return benchmarks.filter((benchmark) => benchmark.tier === "core").map((benchmark) => benchmark.id);
}

/**
 * Derives the leaderboard's Benchmark columns from a selection: the selected
 * Benchmarks in catalogue (data) order. Unknown ids and duplicates are
 * ignored; an empty selection yields no columns.
 */
export function selectedBenchmarks(
  benchmarks: readonly Benchmark[],
  selectedIds: readonly string[],
): Benchmark[] {
  const selected = new Set(selectedIds);
  return benchmarks.filter((benchmark) => selected.has(benchmark.id));
}

/** Direction of a leaderboard column sort. */
export type SortDirection = "asc" | "desc";

/** The fixed leaderboard columns derived from Model fields. */
export type ModelColumnId =
  | "model-name"
  | "provider"
  | "license"
  | "context-window"
  | "input-price"
  | "output-price"
  | "average"
  | "coverage";

/** A sortable leaderboard column: a Model field column or a Benchmark id. */
export type SortColumn = ModelColumnId | (string & {});

/** The active column sort. */
export interface LeaderboardSort {
  column: SortColumn;
  direction: SortDirection;
}

/** Everything a column sort needs besides the Models themselves. */
export interface LeaderboardContext {
  /** All Scores; Primary scores feed the Average, Coverage, and Benchmark columns. */
  scores: readonly Score[];
  /** The selected Benchmark ids the Average and Coverage are computed over. */
  benchmarkIds: readonly string[];
}

/**
 * The leaderboard ranking: Models ordered by Average descending. Equal
 * Averages break by higher Coverage, then by Model name ascending
 * (case-insensitive), so the order is deterministic and defensible.
 * null-Average Models — no Primary score among the selected Benchmarks —
 * sort last, below every scored Model, ordered by name ascending among
 * themselves. Only Primary scores feed the ranking, and Coverage is
 * counted against the active Benchmark selection.
 */
export function rankModelsByAverage(
  models: readonly Model[],
  context: LeaderboardContext,
): Model[] {
  const results = new Map<string, AverageResult>();
  for (const model of models) {
    results.set(
      model.id,
      computeAverage(model.id, context.scores, { benchmarkIds: context.benchmarkIds }),
    );
  }
  return [...models].sort((left, right) => compareForRanking(left, right, results));
}

/** The ranking chain after the primary comparison ties: Coverage desc, name asc. */
function compareForRanking(
  left: Model,
  right: Model,
  results: ReadonlyMap<string, AverageResult>,
): number {
  const leftResult = results.get(left.id);
  const rightResult = results.get(right.id);
  const leftAverage = leftResult?.average ?? null;
  const rightAverage = rightResult?.average ?? null;

  // null Averages sort last, below every scored Model, by name among themselves.
  if (leftAverage === null && rightAverage === null) return compareModelNames(left, right);
  if (leftAverage === null) return 1;
  if (rightAverage === null) return -1;
  if (leftAverage !== rightAverage) return rightAverage - leftAverage;

  const leftCoverage = leftResult?.coverage ?? 0;
  const rightCoverage = rightResult?.coverage ?? 0;
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;

  return compareModelNames(left, right);
}

/** Case-insensitive Model name comparison for deterministic ordering. */
function compareModelNames(left: Model, right: Model): number {
  const a = left.name.toLowerCase();
  const b = right.name.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The sortable value of one column for one Model; null means missing. */
type ColumnValue = string | number | null;

function columnValueFor(model: Model, column: SortColumn, context: LeaderboardContext): ColumnValue {
  switch (column) {
    case "model-name":
      return model.name;
    case "provider":
      return model.provider;
    case "license":
      return model.license;
    case "context-window":
      return model.contextWindow;
    case "input-price":
      return model.inputPricePer1M;
    case "output-price":
      return model.outputPricePer1M;
    case "average":
      return computeAverage(model.id, context.scores, { benchmarkIds: context.benchmarkIds }).average;
    case "coverage":
      return computeAverage(model.id, context.scores, { benchmarkIds: context.benchmarkIds }).coverage;
    default:
      // Any other column id is a Benchmark id; missing Scores sort last.
      return primaryScoreFor(model.id, column, context.scores)?.value ?? null;
  }
}

/**
 * Compares two column values in the given direction. Missing values (null)
 * always sort last — "n/a" is never treated as zero — and everything else
 * compares naturally (strings case-insensitively).
 */
function compareColumnValues(a: ColumnValue, b: ColumnValue, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let comparison: number;
  if (typeof a === "string" || typeof b === "string") {
    const left = String(a).toLowerCase();
    const right = String(b).toLowerCase();
    comparison = left < right ? -1 : left > right ? 1 : 0;
  } else {
    comparison = a < b ? -1 : a > b ? 1 : 0;
  }
  return direction === "asc" ? comparison : -comparison;
}

/**
 * Sorts the Models by any leaderboard column — a Model field column or a
 * Benchmark column (by its Primary scores). Ties keep the data-package
 * order (stable), and missing values always sort last in both directions.
 */
export function sortModelsByColumn(
  models: readonly Model[],
  sort: LeaderboardSort,
  context: LeaderboardContext,
): Model[] {
  const values = new Map<string, ColumnValue>();
  for (const model of models) {
    values.set(model.id, columnValueFor(model, sort.column, context));
  }
  return [...models].sort((left, right) =>
    compareColumnValues(
      values.get(left.id) ?? null,
      values.get(right.id) ?? null,
      sort.direction,
    ),
  );
}

/** Search and filter criteria for the Model list. Empty fields match all. */
export interface ModelQuery {
  /** Case-insensitive substring match against Model name or Provider. */
  search?: string;
  /** When non-empty, only these License categories match. */
  licenses?: readonly License[];
  /** When non-empty, only these Providers match. */
  providers?: readonly string[];
  /** Minimum Context window in tokens. */
  minContextWindow?: number;
  /** Maximum input price per 1M tokens; Models without a public rate never match. */
  maxInputPricePer1M?: number;
  /** Maximum output price per 1M tokens; Models without a public rate never match. */
  maxOutputPricePer1M?: number;
}

/**
 * Filters Models by search and filter criteria, combined with AND semantics.
 * A search matches the Model name or the Provider; price ceilings exclude
 * Models with no public API rate (self-hosted).
 */
export function filterModels(models: readonly Model[], query: ModelQuery): Model[] {
  const search = query.search?.trim().toLowerCase() ?? "";
  return models.filter((model) => {
    if (search !== "") {
      const matches =
        model.name.toLowerCase().includes(search) || model.provider.toLowerCase().includes(search);
      if (!matches) return false;
    }
    if (query.licenses !== undefined && query.licenses.length > 0) {
      if (!query.licenses.includes(model.license)) return false;
    }
    if (query.providers !== undefined && query.providers.length > 0) {
      if (!query.providers.includes(model.provider)) return false;
    }
    if (query.minContextWindow !== undefined && model.contextWindow < query.minContextWindow) {
      return false;
    }
    if (
      query.maxInputPricePer1M !== undefined &&
      (model.inputPricePer1M === null || model.inputPricePer1M > query.maxInputPricePer1M)
    ) {
      return false;
    }
    if (
      query.maxOutputPricePer1M !== undefined &&
      (model.outputPricePer1M === null || model.outputPricePer1M > query.maxOutputPricePer1M)
    ) {
      return false;
    }
    return true;
  });
}
