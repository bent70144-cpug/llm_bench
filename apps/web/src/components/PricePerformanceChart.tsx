import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Model, Score } from "@llm-bench/schema";
import { pricingConfig } from "@llm-bench/data";
import {
  activeAggregateResult,
  blendedPricePer1M,
  formatCoverage,
  weightsAreActive,
  type AverageResult,
  type BenchmarkWeights,
} from "@llm-bench/scoring";
import { formatOneDecimal, portalTooltipStyle } from "../chart-utils";
import { Link } from "../router";
import { modelPath } from "../routes";

/**
 * The price/performance scatter (ticket 11): one point per Model — its
 * active aggregate (Average, or Weighted Average when weights are active on
 * the selection) against a visitor-chosen price basis (Input, Output, or
 * Blended price), computed entirely from the data package through
 * @llm-bench/scoring. Pure SVG, no charting dependency, in ticket 09's
 * chart style: the axis ranges are derived from the plotted Models, the
 * Blended price ratio is read from packages/data/pricing-config.json (never
 * hardcoded), and Models without a public API rate are never plotted — they
 * are listed separately below the chart, not silently dropped.
 *
 * Accessibility: every point is a focusable role="img" group whose
 * aria-label reads the Model name, the aggregate, its Coverage (n/selected),
 * the price, and Source-type-free practical facts; hover and keyboard focus
 * show the same content as a portal tooltip (ticket 07's pattern), so the
 * chart is perceivable and operable without a mouse.
 */

/** The visitor-selectable price bases. */
export type PriceBasis = "input" | "output" | "blended";

interface PricePerformanceChartProps {
  /** The Models in the active view (the leaderboard's filtered rows). */
  models: readonly Model[];
  /** All Scores; Primary scores feed the active aggregate. */
  scores: readonly Score[];
  /** The selected Benchmark ids the aggregate is computed over. */
  benchmarkIds: readonly string[];
  /** Visitor-assigned per-Benchmark weights, when any are active. */
  weights?: BenchmarkWeights;
}

/** One plotted Model: its active aggregate and its price on the basis. */
interface ScatterPoint {
  model: Model;
  aggregate: AverageResult;
  price: number;
}

const PRICE_BASES: readonly { id: PriceBasis; label: string }[] = [
  { id: "input", label: "Input price / 1M" },
  { id: "output", label: "Output price / 1M" },
  { id: "blended", label: "Blended price / 1M" },
];

/**
 * The Blended-price methodology, read from the pricing-config data:
 * (inputWeight × Input price + outputWeight × Output price) / weight sum.
 */
const BLENDED_FORMULA = `(${pricingConfig.inputWeight} × Input price + ${pricingConfig.outputWeight} × Output price) / ${
  pricingConfig.inputWeight + pricingConfig.outputWeight
}`;

function basisLabel(basis: PriceBasis): string {
  return PRICE_BASES.find((entry) => entry.id === basis)!.label;
}

/** The price of one Model on the chosen basis; null when it has none. */
function priceOnBasis(model: Model, basis: PriceBasis): number | null {
  if (basis === "input") return model.inputPricePer1M;
  if (basis === "output") return model.outputPricePer1M;
  return blendedPricePer1M(model, pricingConfig);
}

/** A "nice" tick step (1, 2, 2.5, 5 × 10^k) near the requested size. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * The axis scale for a data maximum: a "nice" step near a quarter of the
 * range, and a maximum that is a whole multiple of that step — so the ticks
 * and the axis end read cleanly (8 → step 2, ticks 0–8; 16 → step 5, ticks
 * 0–20; 97 → step 25, ticks 0–100).
 */
function axisScale(max: number): { axisMax: number; step: number } {
  if (max <= 0) return { axisMax: 1, step: 1 };
  const step = niceStep(max / 4);
  return { axisMax: step * Math.ceil(max / step), step };
}

/** Tick positions across an axis scale, 0 to the axis maximum inclusive. */
function ticksFor(axisMax: number, step: number): number[] {
  const ticks: number[] = [];
  for (let tick = 0; tick < axisMax; tick += step) ticks.push(tick);
  ticks.push(axisMax);
  return ticks;
}

/** Tick labels stay readable: 2.5 renders "2.5", 10 renders "10". */
function formatTick(tick: number): string {
  return Number(tick.toFixed(2)).toString();
}

// Layout, in SVG user units (the viewBox scales to the container's width).
const WIDTH = 640;
const HEIGHT = 400;
const MARGIN = { top: 20, right: 24, bottom: 52, left: 56 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

export function PricePerformanceChart({
  models,
  scores,
  benchmarkIds,
  weights,
}: PricePerformanceChartProps) {
  // The price basis is a local view choice (like the theme), deliberately
  // not URL state — ticket 06's parameters carry the selection and weights
  // that drive the aggregate; the basis only re-labels the price axis.
  const [basis, setBasis] = useState<PriceBasis>("blended");
  const radioGroup = useId();
  const [tooltip, setTooltip] = useState<{ anchor: Element; point: ScatterPoint } | null>(
    null,
  );

  const aggregateLabel = useMemo(
    () =>
      weightsAreActive(weights ?? {}, benchmarkIds) ? "Weighted Average" : "Average",
    [weights, benchmarkIds],
  );

  // Every Model's active aggregate over the current selection — the same
  // number the leaderboard's Average column shows.
  const aggregates = useMemo(() => {
    const context = { scores, benchmarkIds, weights };
    const results = new Map<string, AverageResult>();
    for (const model of models) {
      results.set(model.id, activeAggregateResult(model.id, context));
    }
    return results;
  }, [models, scores, benchmarkIds, weights]);

  // The price invariant (both prices present or both null) splits the view:
  // null-priced Models are listed below the chart, never plotted.
  const nullPriced = useMemo(
    () => models.filter((model) => model.inputPricePer1M === null),
    [models],
  );
  const priced = useMemo(
    () => models.filter((model) => model.inputPricePer1M !== null),
    [models],
  );

  const points = useMemo<ScatterPoint[]>(() => {
    const plotted: ScatterPoint[] = [];
    for (const model of priced) {
      const aggregate = aggregates.get(model.id)!;
      const price = priceOnBasis(model, basis);
      // A Model needs both a price and an aggregate to sit on the axes;
      // "n/a" is never plotted as zero.
      if (aggregate.average !== null && price !== null) {
        plotted.push({ model, aggregate, price });
      }
    }
    return plotted;
  }, [priced, aggregates, basis]);

  // Priced Models without an aggregate on the current selection are not
  // plotted either — named in a note, never silently dropped.
  const withoutAggregate = useMemo(
    () => priced.filter((model) => aggregates.get(model.id)?.average == null),
    [priced, aggregates],
  );

  const xScale = useMemo(() => axisScale(Math.max(...points.map((p) => p.price), 0)), [points]);
  const yScale = useMemo(
    () => axisScale(Math.max(...points.map((p) => p.aggregate.average ?? 0), 0)),
    [points],
  );

  const x = (price: number): number => MARGIN.left + (price / xScale.axisMax) * PLOT_WIDTH;
  const y = (aggregate: number): number =>
    MARGIN.top + (1 - aggregate / yScale.axisMax) * PLOT_HEIGHT;

  /** The accessible reading of one point — identical on hover, focus, and
   *  for screen readers: Model, aggregate, Coverage, price, practical facts. */
  const pointLabel = (point: ScatterPoint): string => {
    const { model, aggregate, price } = point;
    const rate =
      model.referenceInferenceProvider === null
        ? ""
        : `, rate from ${model.referenceInferenceProvider}`;
    return (
      `${model.name}: ${aggregateLabel} ${formatOneDecimal(aggregate.average ?? 0)}, ` +
      `Coverage ${formatCoverage(aggregate)}, ${basisLabel(basis)} $${price.toFixed(2)}, ` +
      `Provider ${model.provider}${rate}`
    );
  };

  const showTooltip = (point: ScatterPoint, anchor: Element): void =>
    setTooltip({ anchor, point });
  const activeBasisLabel = `${basisLabel(basis)} ($)`;

  return (
    <section className="price-performance" aria-label="Price vs performance">
      <h2 id="price-vs-performance">Price vs performance</h2>
      <p className="detail-note">
        Each point is one Model: its {aggregateLabel} — from Primary scores only, over{" "}
        {benchmarkIds.length} selected Benchmark{benchmarkIds.length === 1 ? "" : "s"} — against
        the chosen price basis. Better-value Models sit up and to the left. Models without a
        public API rate are never plotted; they are listed below the chart.
      </p>

      <fieldset className="price-basis">
        <legend>Price basis</legend>
        {PRICE_BASES.map((entry) => (
          <label key={entry.id} className="check-option basis-option">
            <input
              type="radio"
              name={radioGroup}
              value={entry.id}
              checked={basis === entry.id}
              onChange={() => setBasis(entry.id)}
            />
            {entry.label}
            {entry.id === "blended" ? (
              <span className="basis-formula">{BLENDED_FORMULA}</span>
            ) : null}
          </label>
        ))}
      </fieldset>

      {points.length === 0 ? (
        <p className="missing">
          No Models to plot — none of the Models shown has both a public API rate and an{" "}
          {aggregateLabel} over the current selection.
        </p>
      ) : (
        <svg
          className="scatter-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={`Scatter plot: ${aggregateLabel} against ${activeBasisLabel}, one point per Model`}
        >
          {/* Gridlines and tick labels, both axes, from the data ranges. */}
          {ticksFor(xScale.axisMax, xScale.step).map((tick) => (
            <g key={`x-${tick}`} className="scatter-grid">
              <line x1={x(tick)} y1={MARGIN.top} x2={x(tick)} y2={MARGIN.top + PLOT_HEIGHT} />
              <text
                x={x(tick)}
                y={MARGIN.top + PLOT_HEIGHT + 16}
                textAnchor="middle"
                className="axis-tick"
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {ticksFor(yScale.axisMax, yScale.step).map((tick) => (
            <g key={`y-${tick}`} className="scatter-grid">
              <line x1={MARGIN.left} y1={y(tick)} x2={MARGIN.left + PLOT_WIDTH} y2={y(tick)} />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" className="axis-tick">
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {/* Axis titles: the price basis on X, the active aggregate on Y. */}
          <text
            x={MARGIN.left + PLOT_WIDTH / 2}
            y={HEIGHT - 10}
            textAnchor="middle"
            className="axis-title"
          >
            {activeBasisLabel}
          </text>
          <text
            x={14}
            y={MARGIN.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            className="axis-title"
            transform={`rotate(-90 14 ${MARGIN.top + PLOT_HEIGHT / 2})`}
          >
            {aggregateLabel}
          </text>

          {/* One focusable point per plotted Model. */}
          {points.map((point) => (
            <g
              key={point.model.id}
              className="scatter-point chart-series-0"
              transform={`translate(${x(point.price)}, ${y(point.aggregate.average ?? 0)})`}
              tabIndex={0}
              role="img"
              aria-label={pointLabel(point)}
              onMouseEnter={(event) => showTooltip(point, event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip(point, event.currentTarget)}
              onBlur={() => setTooltip(null)}
            >
              <circle r={5} />
            </g>
          ))}
        </svg>
      )}

      {withoutAggregate.length > 0 ? (
        <p className="chart-note">
          Not plotted — no {aggregateLabel} over the current selection:{" "}
          {withoutAggregate.map((model) => model.name).join(", ")}.
        </p>
      ) : null}

      {nullPriced.length > 0 ? (
        <div className="self-hosted-list">
          <h3>Self-hosted / no public API rate</h3>
          <ul>
            {nullPriced.map((model) => {
              const aggregate = aggregates.get(model.id)!;
              return (
                <li key={model.id}>
                  <Link to={modelPath(model.id)}>{model.name}</Link> — {aggregateLabel}{" "}
                  {aggregate.average === null ? (
                    <span className="missing">n/a</span>
                  ) : (
                    formatOneDecimal(aggregate.average)
                  )}{" "}
                  {formatCoverage(aggregate)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* The point tooltip (ticket 07's portal pattern): fixed-positioned
          from the point's bounding box, so nothing can clip it. */}
      {tooltip !== null && (
        <PointTooltip
          anchor={tooltip.anchor}
          point={tooltip.point}
          aggregateLabel={aggregateLabel}
          basis={basis}
        />
      )}
    </section>
  );
}

/** The hover/focus tooltip for one point, rendered into a portal. */
function PointTooltip({
  anchor,
  point,
  aggregateLabel,
  basis,
}: {
  anchor: Element;
  point: ScatterPoint;
  aggregateLabel: string;
  basis: PriceBasis;
}) {
  const rect = anchor.getBoundingClientRect();
  const style = portalTooltipStyle(rect, 340, -100);

  const { model, aggregate, price } = point;
  return createPortal(
    <div role="tooltip" className="score-tooltip point-tooltip" style={style}>
      <p>
        <strong>{model.name}</strong>
      </p>
      <p>
        <strong>{aggregateLabel}:</strong> {formatOneDecimal(aggregate.average ?? 0)}{" "}
        {formatCoverage(aggregate)}
      </p>
      <p>
        <strong>{basisLabel(basis)}:</strong> ${price.toFixed(2)}
      </p>
      <p>
        <strong>Provider:</strong> {model.provider}
        {model.referenceInferenceProvider === null
          ? ""
          : ` — rate from ${model.referenceInferenceProvider}`}
      </p>
    </div>,
    document.body,
  );
}
