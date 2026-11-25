/**
 * A grouped horizontal bar chart in pure SVG — no charting dependency.
 *
 * The rows and series are pure data: one bar per series per row, laid out
 * left-to-right in series order. A row value of undefined renders "n/a"
 * where the bar would be — never a zero-length bar (spec: missing values
 * on charts are "n/a", never zero).
 *
 * Accessibility: the SVG is a labelled group; every row is itself a
 * role="img" group whose aria-label reads the row's label and each series'
 * value (or "n/a"), so the whole chart is perceivable without sight. The
 * values also render as visible SVG text. The legend is real HTML.
 *
 * Ticket 09 uses this for the Model page's Model-versus-leaders chart
 * (series 1 = the Model's Primary scores, series 2 = the best Primary
 * score across Models per Benchmark); ticket 10's compare bar chart needs
 * the same primitive with one series per compared Model.
 */

/** One series of bars: a legend entry, and one bar per row. */
export interface ChartSeries {
  /** The legend label (e.g. a Model's name). */
  label: string;
}

/** One chart row: a label (e.g. a Benchmark name) and one value per series. */
export interface ChartRow {
  /** The row's label, shown at the left of its bars. */
  label: string;
  /** One value per series, in series order; undefined renders "n/a". */
  values: readonly (number | undefined)[];
}

interface GroupedBarChartProps {
  /** The accessible name of the whole chart. */
  ariaLabel: string;
  /** The chart's series; each row draws one bar per series, in order. */
  series: readonly ChartSeries[];
  /** The chart's rows, top to bottom, in the order the caller chose. */
  rows: readonly ChartRow[];
  /** The top of the value scale; every value is plotted from 0 to this. */
  maxValue?: number;
}

// Layout, in SVG user units (the viewBox scales to the container's width).
const LABEL_WIDTH = 184;
const BAR_MAX_WIDTH = 396;
const VALUE_WIDTH = 72;
const BAR_HEIGHT = 12;
const BAR_GAP = 4;
const ROW_PADDING = 5;
const TOP_MARGIN = 18; // room for the scale labels above the first row

const CHART_WIDTH = LABEL_WIDTH + BAR_MAX_WIDTH + VALUE_WIDTH;
const ROW_HEIGHT = 2 * ROW_PADDING + 2 * BAR_HEIGHT + BAR_GAP;

/** Gridline ticks across the value scale (0–100 percent scales). */
const TICKS = [0, 25, 50, 75, 100];

const MISSING = "n/a";

/** The row's accessible label: "<row>: <series> <value|n/a>; …". */
function rowAriaLabel(row: ChartRow, series: readonly ChartSeries[]): string {
  const readings = series.map((entry, index) => {
    const value = row.values[index];
    return `${entry.label} ${value === undefined ? MISSING : value}`;
  });
  return `${row.label}: ${readings.join("; ")}`;
}

export function GroupedBarChart({
  ariaLabel,
  series,
  rows,
  maxValue = 100,
}: GroupedBarChartProps) {
  const chartHeight = TOP_MARGIN + rows.length * ROW_HEIGHT;
  const barScale = (value: number): number =>
    LABEL_WIDTH + Math.min(value / maxValue, 1) * BAR_MAX_WIDTH;

  return (
    <figure className="grouped-bar-chart">
      <ul className="chart-legend">
        {series.map((entry, index) => (
          <li key={entry.label} className={`chart-series-${index % 4}`}>
            <span className="chart-swatch" aria-hidden="true" />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
      <svg
        className="bar-chart-svg"
        viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`}
        role="group"
        aria-label={ariaLabel}
      >
        {/* The value scale: gridlines every 25 units, labelled at 0/50/100. */}
        {TICKS.map((tick) => (
          <g key={tick} className="chart-grid">
            <line
              x1={barScale(tick)}
              y1={TOP_MARGIN - 4}
              x2={barScale(tick)}
              y2={chartHeight}
            />
            {tick % 50 === 0 ? (
              <text x={barScale(tick)} y={TOP_MARGIN - 7} textAnchor="middle" className="chart-tick">
                {tick}
              </text>
            ) : null}
          </g>
        ))}
        {rows.map((row, rowIndex) => {
          const top = TOP_MARGIN + rowIndex * ROW_HEIGHT;
          return (
            <g key={row.label} role="img" aria-label={rowAriaLabel(row, series)}>
              <text
                x={LABEL_WIDTH - 8}
                y={top + ROW_HEIGHT / 2 + 4}
                textAnchor="end"
                className="chart-label"
              >
                {row.label}
              </text>
              {series.map((entry, seriesIndex) => {
                const value = row.values[seriesIndex];
                const barTop = top + ROW_PADDING + seriesIndex * (BAR_HEIGHT + BAR_GAP);
                return (
                  <g key={entry.label} className={`chart-series-${seriesIndex % 4}`}>
                    {value === undefined ? (
                      <text x={LABEL_WIDTH + 4} y={barTop + BAR_HEIGHT - 1} className="chart-value missing">
                        {MISSING}
                      </text>
                    ) : (
                      <>
                        <rect
                          x={LABEL_WIDTH}
                          y={barTop}
                          width={Math.max(barScale(value) - LABEL_WIDTH, 1)}
                          height={BAR_HEIGHT}
                          className="chart-bar"
                        />
                        <text x={barScale(value) + 6} y={barTop + BAR_HEIGHT - 1} className="chart-value">
                          {value}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
