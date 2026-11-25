import { useId, useMemo, useState } from "react";
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
  defaultSelectedBenchmarkIds,
  filterModels,
  primaryScoreFor,
  selectedBenchmarks,
  sortModelsByColumn,
  type LeaderboardSort,
  type ModelColumnId,
  type ModelQuery,
  type SortColumn,
} from "@llm-bench/scoring";
import { Link } from "../router";
import { benchmarkPath } from "../routes";
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
  // Tier drives the default Benchmark selection (core selected, extended not).
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>(() =>
    defaultSelectedBenchmarkIds(benchmarks),
  );
  const [search, setSearch] = useState("");
  const [selectedLicenses, setSelectedLicenses] = useState<readonly License[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<readonly string[]>([]);
  const [minContextWindow, setMinContextWindow] = useState("");
  const [maxInputPrice, setMaxInputPrice] = useState("");
  const [maxOutputPrice, setMaxOutputPrice] = useState("");
  const [sort, setSort] = useState<LeaderboardSort | null>(null);
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
    () => ({ scores, benchmarkIds: selectedBenchmarkIds }),
    [selectedBenchmarkIds],
  );
  const rows = useMemo(
    () =>
      sort === null
        ? filteredModels
        : sortModelsByColumn(filteredModels, sort, leaderboardContext),
    [filteredModels, sort, leaderboardContext],
  );

  function handleSortClick(column: SortColumn): void {
    setSort((current) => {
      if (current?.column !== column) return { column, direction: "asc" };
      return { column: current.column, direction: current.direction === "asc" ? "desc" : "asc" };
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
                onChange={() =>
                  setSelectedBenchmarkIds((current) => toggleIn(current, benchmark.id))
                }
              />
              <Link to={benchmarkPath(benchmark.id)}>{benchmark.name}</Link>
              <span className="benchmark-meta">
                {benchmark.category} · {benchmark.tier}
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {MODEL_COLUMNS.map((column) => (
                <SortableTh
                  key={column.id}
                  columnId={column.id}
                  label={column.label}
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
                <td colSpan={MODEL_COLUMNS.length + visibleBenchmarks.length} className="missing">
                  No Models match the current search and filters.
                </td>
              </tr>
            ) : (
              rows.map((model) => {
                const { average, coverage, selected } = computeAverage(model.id, scores, {
                  benchmarkIds: selectedBenchmarkIds,
                });
                return (
                  <tr key={model.id}>
                    <th scope="row">{model.name}</th>
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
                    <td>
                      {average === null ? <span className="missing">n/a</span> : formatAverage(average)}
                    </td>
                    <td>
                      ({coverage}/{selected})
                    </td>
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
        Average and Coverage are computed over the {selectedBenchmarkIds.length} selected
        Benchmark{selectedBenchmarkIds.length === 1 ? "" : "s"}, from Primary scores only; the best
        Score per Benchmark is highlighted. Missing Scores are shown as &ldquo;n/a&rdquo;, never as
        zero, and each Score links to its published source. Each Benchmark&rsquo;s name links to its
        detail page.
      </p>

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
