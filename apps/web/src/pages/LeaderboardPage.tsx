import { useEffect, useId, useMemo, useState } from "react";
import {
  LICENSE_VALUES,
  type Benchmark,
  type License,
  type Model,
  type Score,
} from "@llm-bench/schema";
import { benchmarks, models, scores } from "@llm-bench/data";
import {
  bestValueByBenchmark,
  computeAverage,
  computeWeightedAverage,
  decodeLeaderboardUrlState,
  encodeLeaderboardUrlState,
  filterModels,
  formatCoverage,
  isUnderHalfCoverage,
  primaryScoreFor,
  selectedBenchmarks,
  sortModelsByColumn,
  weightsAreActive,
  type AverageResult,
  type BenchmarkWeights,
  type LeaderboardSort,
  type LeaderboardUrlState,
  type ModelColumnId,
  type ModelQuery,
  type SortColumn,
} from "@llm-bench/scoring";
import { Link } from "../router";
import { benchmarkPath, COMPARE_PATH, modelPath } from "../routes";
import { PricePerformanceChart } from "../components/PricePerformanceChart";
import { ProvenanceTooltip } from "../components/ProvenanceTooltip";
import { ScoreDetailDialog } from "../components/ScoreDetailDialog";

/**
 * The leaderboard renders 100% from the data package: every row, column,
 * filter option, and number below derives from @llm-bench/data via
 * @llm-bench/scoring. Tier drives the default Benchmark selection — core
 * Benchmarks are selected, extended Benchmarks are not — and the table has
 * one column per selected Benchmark, so a new Benchmark in the data package
 * produces its column (and its selection control, and its detail page link)
 * with no UI change.
 *
 * The whole view — Benchmark selection, per-Benchmark weights, sorting,
 * search, and filters — is shareable URL state: it is decoded from the URL
 * on load and written back with replaceState on every change (no history
 * spam), so refreshing or opening a shared URL restores the exact view.
 */

/** The fixed columns derived from the Model schema fields. */
interface ModelColumn {
  id: ModelColumnId;
  label: string;
  title?: string;
  align: "left" | "right";
}

const MODEL_COLUMNS: readonly ModelColumn[] = [
  { id: "model-name", label: "Model", align: "left" },
  { id: "provider", label: "Provider", align: "left" },
  { id: "license", label: "License", align: "left" },
  { id: "context-window", label: "Context window", title: "Context window in tokens", align: "right" },
  {
    id: "input-price",
    label: "Input price / 1M",
    title: "Input price per 1M tokens",
    align: "right",
  },
  {
    id: "output-price",
    label: "Output price / 1M",
    title: "Output price per 1M tokens",
    align: "right",
  },
  // The aggregate column: its label reads "Weighted Average" exactly when
  // a weight is active on the selection, so the visitor can tell which
  // number they are reading. The sort column id stays "average".
  { id: "average", label: "Average", align: "right" },
  { id: "coverage", label: "Coverage", align: "right" },
];

function formatAverage(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function toggleIn<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/**
 * A sortable column header. Benchmark columns pass `href`: their name links
 * to the Benchmark's detail page and sorting moves to a separate arrow
 * button, so both actions are real, focusable elements.
 */
function SortableTh({
  columnId,
  label,
  title,
  align,
  sort,
  onSort,
  href,
}: {
  columnId: SortColumn;
  label: string;
  title?: string;
  align: "left" | "right";
  sort: LeaderboardSort | null;
  onSort: (column: SortColumn) => void;
  href?: string;
}) {
  const active = sort !== null && sort.column === columnId;
  const arrow = active ? (sort.direction === "asc" ? "▲" : "▼") : "↕";
  return (
    <th
      scope="col"
      className={align === "left" ? "text" : undefined}
      title={title}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      {href === undefined ? (
        <button
          type="button"
          className={active ? "sort-button active" : "sort-button"}
          onClick={() => onSort(columnId)}
        >
          {label}
          {active ? (
            <span className="sort-arrow" aria-hidden="true">
              {" "}
              {arrow}
            </span>
          ) : null}
        </button>
      ) : (
        <>
          <Link to={href} className="column-link">
            {label}
          </Link>
          <button
            type="button"
            className={active ? "sort-button active" : "sort-button"}
            aria-label={`Sort by ${label}`}
            onClick={() => onSort(columnId)}
          >
            <span aria-hidden="true">{arrow}</span>
          </button>
        </>
      )}
    </th>
  );
}

export function LeaderboardPage() {
  // The view loads from the URL (shared links and refresh restore the exact
  // selection, weights, sorting, search, and filters) and falls back to the
  // Tier-driven defaults when the URL carries no state.
  const [initialUrlState] = useState(() =>
    decodeLeaderboardUrlState(window.location.search, benchmarks),
  );
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<readonly string[]>(
    initialUrlState.benchmarkIds,
  );
  // Weight inputs keep their raw draft text per Benchmark ("2", "0.5", …)
  // so typing is never fought; the canonical weights are derived from the
  // drafts. Drafts of unselected Benchmarks are remembered, so re-selecting
  // a Benchmark restores its weight.
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialUrlState.weights).map(([id, weight]) => [id, String(weight)]),
    ),
  );
  const [search, setSearch] = useState(initialUrlState.search);
  const [selectedLicenses, setSelectedLicenses] = useState<readonly License[]>(
    initialUrlState.licenses,
  );
  const [selectedProviders, setSelectedProviders] = useState<readonly string[]>(
    initialUrlState.providers,
  );
  const [minContextWindow, setMinContextWindow] = useState(
    initialUrlState.minContextWindow === undefined ? "" : String(initialUrlState.minContextWindow),
  );
  const [maxInputPrice, setMaxInputPrice] = useState(
    initialUrlState.maxInputPricePer1M === undefined
      ? ""
      : String(initialUrlState.maxInputPricePer1M),
  );
  const [maxOutputPrice, setMaxOutputPrice] = useState(
    initialUrlState.maxOutputPricePer1M === undefined
      ? ""
      : String(initialUrlState.maxOutputPricePer1M),
  );
  // The leaderboard opens on the ranking: the active aggregate (Average, or
  // Weighted Average when weights are active) descending with the
  // deterministic tie-breaks — computed by @llm-bench/scoring.
  const [sort, setSort] = useState<LeaderboardSort>(initialUrlState.sort);
  // Compared Model ids (ticket 10): the 2 to 4 Models the visitor picks for
  // the side-by-side comparison. They ride in the URL `compare` parameter
  // verbatim (kept as decoded — a stale id in a shared link stays honest
  // until the compare view drops it with a note), so the selection is
  // shareable and survives refresh.
  const [comparedModelIds, setComparedModelIds] = useState<readonly string[]>(
    initialUrlState.comparedModelIds,
  );
  // Score provenance (ticket 07): the tooltip anchors to the hovered or
  // focused score cell; the Score details panel opens for one pair.
  const tooltipId = useId();
  const [scoreTooltip, setScoreTooltip] = useState<{
    anchor: HTMLElement;
    score: Score;
  } | null>(null);
  const [detailPair, setDetailPair] = useState<{ model: Model; benchmark: Benchmark } | null>(
    null,
  );

  const visibleBenchmarks = useMemo(
    () => selectedBenchmarks(benchmarks, selectedBenchmarkIds),
    [selectedBenchmarkIds],
  );
  const bestByBenchmark = useMemo(() => bestValueByBenchmark(scores), []);
  /** Provider filter options, generated from the Model data. */
  const providersInData = useMemo(
    () => [...new Set(models.map((model) => model.provider))].sort(),
    [],
  );

  // The canonical weights: every Benchmark whose draft is a finite number
  // ≥ 0 other than the default 1 (invalid drafts are simply the default —
  // defaults win). Weights on unselected Benchmarks are remembered but do
  // not switch the aggregate label: they do not change the displayed number.
  const weights = useMemo<BenchmarkWeights>(() => {
    const canonical: Record<string, number> = {};
    for (const benchmark of benchmarks) {
      const draft = weightDrafts[benchmark.id];
      if (draft === undefined) continue;
      const parsed = Number(draft);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed !== 1) {
        canonical[benchmark.id] = parsed;
      }
    }
    return canonical;
  }, [weightDrafts]);
  const aggregateLabel = weightsAreActive(weights, selectedBenchmarkIds)
    ? "Weighted Average"
    : "Average";

  const query: ModelQuery = useMemo(
    () => ({
      search,
      licenses: selectedLicenses.length > 0 ? selectedLicenses : undefined,
      providers: selectedProviders.length > 0 ? selectedProviders : undefined,
      minContextWindow: minContextWindow === "" ? undefined : Number(minContextWindow),
      maxInputPricePer1M: maxInputPrice === "" ? undefined : Number(maxInputPrice),
      maxOutputPricePer1M: maxOutputPrice === "" ? undefined : Number(maxOutputPrice),
    }),
    [search, selectedLicenses, selectedProviders, minContextWindow, maxInputPrice, maxOutputPrice],
  );

  const filteredModels = useMemo(() => filterModels(models, query), [query]);
  const leaderboardContext = useMemo(
    () => ({ scores, benchmarkIds: selectedBenchmarkIds, weights }),
    [selectedBenchmarkIds, weights],
  );
  const rows = useMemo(
    () => sortModelsByColumn(filteredModels, sort, leaderboardContext),
    [filteredModels, sort, leaderboardContext],
  );

  // The active aggregate of one Model: the Weighted Average when weights
  // are active on the selection, the plain Average otherwise.
  const aggregateFor = (modelId: string): AverageResult =>
    weightsAreActive(weights, selectedBenchmarkIds)
      ? computeWeightedAverage(modelId, scores, {
          benchmarkIds: selectedBenchmarkIds,
          weights,
        })
      : computeAverage(modelId, scores, { benchmarkIds: selectedBenchmarkIds });

  // The whole view is URL state: every change is written back with
  // replaceState (no history spam), so the URL is always a shareable link
  // and a refresh restores the exact view.
  const urlState = useMemo<LeaderboardUrlState>(
    () => ({
      benchmarkIds: selectedBenchmarkIds,
      weights,
      sort,
      search,
      licenses: selectedLicenses,
      providers: selectedProviders,
      minContextWindow: minContextWindow === "" ? undefined : Number(minContextWindow),
      maxInputPricePer1M: maxInputPrice === "" ? undefined : Number(maxInputPrice),
      maxOutputPricePer1M: maxOutputPrice === "" ? undefined : Number(maxOutputPrice),
      comparedModelIds,
    }),
    [
      selectedBenchmarkIds,
      weights,
      sort,
      search,
      selectedLicenses,
      selectedProviders,
      minContextWindow,
      maxInputPrice,
      maxOutputPrice,
      comparedModelIds,
    ],
  );

  useEffect(() => {
    const query = encodeLeaderboardUrlState(urlState);
    const nextUrl = `${window.location.pathname}?${query}`;
    if (nextUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [urlState]);

  function handleSortClick(column: SortColumn): void {
    setSort((current) => {
      if (current?.column !== column) return { column, direction: "asc" };
      return { column: current.column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  // The selection is kept in catalogue order, so the URL's benchmarks=
  // parameter is stable no matter the order Benchmarks were toggled in.
  function handleBenchmarkToggle(benchmarkId: string): void {
    setSelectedBenchmarkIds((current) => {
      const next = new Set(current);
      if (next.has(benchmarkId)) {
        next.delete(benchmarkId);
      } else {
        next.add(benchmarkId);
      }
      return benchmarks
        .filter((benchmark) => next.has(benchmark.id))
        .map((benchmark) => benchmark.id);
    });
  }

  // A comparison shows 2 to 4 Models: unchecking always works, and once 4
  // ids are selected the other rows' checkboxes disable (the guard is here
  // as well — the compare view also defends its own rails).
  function handleCompareToggle(modelId: string): void {
    setComparedModelIds((current) => {
      if (current.includes(modelId)) {
        return current.filter((id) => id !== modelId);
      }
      return current.length >= 4 ? current : [...current, modelId];
    });
  }

  return (
    <>
      <h1>LLM Bench</h1>
      <p className="page-intro">
        Published Results only: every Score is a real number from a Provider, a paper, a
        leaderboard, or a third-party report. Benchmarks in the core Tier are selected by
        default; extended-Tier Benchmarks can be added below.
      </p>

      <section className="controls" aria-label="Search, filters, and Benchmark selection">
        <label className="search-control">
          Search
          <input
            type="search"
            placeholder="Model or Provider"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <fieldset>
          <legend>License</legend>
          {LICENSE_VALUES.map((license) => (
            <label key={license} className="check-option">
              <input
                type="checkbox"
                checked={selectedLicenses.includes(license)}
                onChange={() => setSelectedLicenses((current) => toggleIn(current, license))}
              />
              {license}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Provider</legend>
          {providersInData.map((provider) => (
            <label key={provider} className="check-option">
              <input
                type="checkbox"
                checked={selectedProviders.includes(provider)}
                onChange={() => setSelectedProviders((current) => toggleIn(current, provider))}
              />
              {provider}
            </label>
          ))}
        </fieldset>

        <label className="number-control">
          Minimum Context window (tokens)
          <input
            type="number"
            min="0"
            step="1000"
            value={minContextWindow}
            onChange={(event) => setMinContextWindow(event.target.value)}
          />
        </label>
        <label className="number-control">
          Maximum Input price / 1M
          <input
            type="number"
            min="0"
            step="0.1"
            value={maxInputPrice}
            onChange={(event) => setMaxInputPrice(event.target.value)}
          />
        </label>
        <label className="number-control">
          Maximum Output price / 1M
          <input
            type="number"
            min="0"
            step="0.1"
            value={maxOutputPrice}
            onChange={(event) => setMaxOutputPrice(event.target.value)}
          />
        </label>

        <fieldset className="benchmarks-selection">
          <legend>Benchmarks</legend>
          {benchmarks.map((benchmark) => (
            <label key={benchmark.id} className="check-option benchmark-option">
              <input
                type="checkbox"
                checked={selectedBenchmarkIds.includes(benchmark.id)}
                onChange={() => handleBenchmarkToggle(benchmark.id)}
              />
              <Link to={benchmarkPath(benchmark.id)}>{benchmark.name}</Link>
              <span className="benchmark-meta">
                {benchmark.category} · {benchmark.tier}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="weights-selection">
          <legend>Benchmark weights</legend>
          <p className="weights-hint">
            The default weight is 1. A weight of 0 excludes a Benchmark from the Weighted
            Average while keeping it selected for Coverage; a weight below or above 1 scales
            its contribution.
          </p>
          {visibleBenchmarks.length === 0 ? (
            <p className="weights-empty">No Benchmarks selected.</p>
          ) : (
            visibleBenchmarks.map((benchmark) => (
              <label key={benchmark.id} className="number-control weight-option">
                {`Weight — ${benchmark.name}`}
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={weightDrafts[benchmark.id] ?? "1"}
                  onChange={(event) =>
                    setWeightDrafts((current) => ({
                      ...current,
                      [benchmark.id]: event.target.value,
                    }))
                  }
                />
              </label>
            ))
          )}
        </fieldset>
      </section>

      {/* The compare affordance (ticket 10): the per-row Compare checkboxes
          above, and here the control that opens the side-by-side view once
          2 to 4 Models are selected. It is a real link carrying the whole
          shared URL state, so a comparison is itself a shareable link. */}
      <div className="compare-controls">
        <p className="compare-hint">Select 2 to 4 Models in the Compare column, then open the side-by-side comparison.</p>
        {comparedModelIds.length >= 2 ? (
          <Link className="compare-link" to={`${COMPARE_PATH}?${encodeLeaderboardUrlState(urlState)}`}>
            Compare selected ({comparedModelIds.length})
          </Link>
        ) : (
          <button type="button" className="compare-link" disabled>
            Compare selected ({comparedModelIds.length})
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="compare-column">
                Compare
              </th>
              {MODEL_COLUMNS.map((column) => (
                <SortableTh
                  key={column.id}
                  columnId={column.id}
                  label={column.id === "average" ? aggregateLabel : column.label}
                  title={column.title}
                  align={column.align}
                  sort={sort}
                  onSort={handleSortClick}
                />
              ))}
              {visibleBenchmarks.map((benchmark) => (
                <SortableTh
                  key={benchmark.id}
                  columnId={benchmark.id}
                  label={benchmark.name}
                  title={`${benchmark.category} · Tier ${benchmark.tier} · ${benchmark.metric}`}
                  align="right"
                  sort={sort}
                  onSort={handleSortClick}
                  href={benchmarkPath(benchmark.id)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={1 + MODEL_COLUMNS.length + visibleBenchmarks.length} className="missing">
                  No Models match the current search and filters.
                </td>
              </tr>
            ) : (
              rows.map((model) => {
                const { average, coverage, selected } = aggregateFor(model.id);
                return (
                  <tr key={model.id}>
                    {/* The per-row Compare checkbox (ticket 10): keyboard
                        operable, and disabled once 4 Models are selected
                        (unchecking always works). */}
                    <td className="compare-cell">
                      <input
                        type="checkbox"
                        aria-label={`Compare ${model.name}`}
                        checked={comparedModelIds.includes(model.id)}
                        disabled={
                          !comparedModelIds.includes(model.id) && comparedModelIds.length >= 4
                        }
                        onChange={() => handleCompareToggle(model.id)}
                      />
                    </td>
                    <th scope="row">
                      <Link to={modelPath(model.id)}>{model.name}</Link>
                    </th>
                    <td className="text">{model.provider}</td>
                    <td className="text">
                      <span>{model.license}</span>
                      {model.licenseName ? (
                        <span className="license-name">{model.licenseName}</span>
                      ) : null}
                    </td>
                    <td>{model.contextWindow.toLocaleString("en-US")}</td>
                    <td>
                      {model.inputPricePer1M === null ? (
                        <span className="missing">self-hosted / no public API rate</span>
                      ) : (
                        model.inputPricePer1M.toFixed(2)
                      )}
                    </td>
                    <td>
                      {model.outputPricePer1M === null ? (
                        <span className="missing">self-hosted / no public API rate</span>
                      ) : (
                        model.outputPricePer1M.toFixed(2)
                      )}
                    </td>
                    <td className="average-cell">
                      {average === null ? (
                        <span className="missing">n/a</span>
                      ) : (
                        formatAverage(average)
                      )}{" "}
                      <span className="coverage-count">
                        {formatCoverage({ average, coverage, selected })}
                      </span>
                      {isUnderHalfCoverage({ average, coverage, selected }) ? (
                        <span className="coverage-badge">Under 50% Coverage</span>
                      ) : null}
                    </td>
                    <td>{formatCoverage({ average, coverage, selected })}</td>
                    {visibleBenchmarks.map((benchmark) => {
                      const score = primaryScoreFor(model.id, benchmark.id, scores);
                      const isBest =
                        score !== undefined && score.value === bestByBenchmark.get(benchmark.id);
                      return (
                        <td key={benchmark.id} className={isBest ? "best" : undefined}>
                          {score === undefined ? (
                            <span className="missing">n/a</span>
                          ) : (
                            <span
                              className="score-cell"
                              onMouseEnter={(event) =>
                                setScoreTooltip({ anchor: event.currentTarget, score })
                              }
                              onMouseLeave={() => setScoreTooltip(null)}
                              onFocus={(event) =>
                                setScoreTooltip({ anchor: event.currentTarget, score })
                              }
                              onBlur={() => setScoreTooltip(null)}
                            >
                              {/* The value stays a real anchor to the Score's
                                  source URL; the tooltip and the details
                                  button beside it carry the provenance. */}
                              <a
                                href={score.sourceUrl}
                                className="score-link"
                                aria-describedby={tooltipId}
                              >
                                {score.value}
                              </a>
                              <button
                                type="button"
                                className="score-details-button"
                                aria-haspopup="dialog"
                                aria-label={`Score details: ${model.name} on ${benchmark.name}`}
                                aria-describedby={tooltipId}
                                onClick={() => setDetailPair({ model, benchmark })}
                              >
                                <span aria-hidden="true">ⓘ</span>
                              </button>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        {aggregateLabel === "Weighted Average" ? "Weighted Average over" : "Average over"}{" "}
        {selectedBenchmarkIds.length} selected
        Benchmark{selectedBenchmarkIds.length === 1 ? "" : "s"}, from Primary scores only:
        every {aggregateLabel} is shown with its Coverage as (n/{selectedBenchmarkIds.length}),
        and Models under 50% Coverage of the active selection carry an &ldquo;Under 50%
        Coverage&rdquo; badge. The best Score per Benchmark is highlighted. Missing Scores are
        shown as &ldquo;n/a&rdquo;, never as zero, and each Score links to its published source.
        Each Benchmark&rsquo;s name links to its detail page, and so does each Model&rsquo;s
        name. Select 2 to 4 Models with the Compare checkboxes to open the side-by-side
        comparison.
        {aggregateLabel === "Weighted Average" ? (
          <>
            {" "}
            Weights are visitor-assigned per Benchmark; a Model missing a Benchmark is not
            penalized — the Weighted Average normalizes over the weights of the Benchmarks the
            Model actually has, while Coverage stays unweighted.
          </>
        ) : null}
      </p>

      {/* Price vs performance (ticket 11): the same filtered Models and the
          same active aggregate (Average, or Weighted Average when weights are
          active) as the table, plotted against a visitor-chosen price basis. */}
      <PricePerformanceChart
        models={filteredModels}
        scores={scores}
        benchmarkIds={selectedBenchmarkIds}
        weights={weights}
      />

      {/* Score provenance affordances (ticket 07): one shared tooltip for
          the hovered/focused score cell, and the Score details panel. */}
      {scoreTooltip !== null && (
        <ProvenanceTooltip id={tooltipId} anchor={scoreTooltip.anchor} score={scoreTooltip.score} />
      )}
      {detailPair !== null && (
        <ScoreDetailDialog
          model={detailPair.model}
          benchmark={detailPair.benchmark}
          scores={scores}
          onClose={() => setDetailPair(null)}
        />
      )}
    </>
  );
}
