/**
 * Pure-SVG charts — no charting dependency.
 *
 * `GroupedBarChart`: one horizontal bar per series per row, laid out
 * left-to-right in series order. A row value of undefined renders "n/a"
 * where the bar would be — never a zero-length bar (spec: missing values
 * on charts are "n/a", never zero).
 *
 * `RadarChart` (ticket 10's compare view): one polygon per series around
 * one axis per row. A missing value leaves a gap in the polygon — a dashed
 * segment runs to the series' next known vertex and the axis carries an
 * "n/a" label — never a plotted zero.
 *
 * Accessibility: each SVG is a labelled group; every series (radar) or row
 * (bars) is itself a role="img" group whose aria-label reads its label and
 * each series' value (or "n/a"), so the whole chart is perceivable without
 * sight. The values also render as visible SVG text. The legend is real
 * HTML.
 *
 * Ticket 09 uses the bars for the Model page's Model-versus-leaders chart
 * (series 1 = the Model's Primary scores, series 2 = the best Primary
 * score across Models per Benchmark); ticket 10's compare view uses one
 * series per compared Model on both charts.
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

// --- Radar chart (ticket 10: the compare view) -------------------------------

interface RadarChartProps {
  /** The accessible name of the whole chart. */
  ariaLabel: string;
  /** The chart's series; one polygon per series, in order. */
  series: readonly ChartSeries[];
  /** The chart's axes, clockwise from the top, in the order the caller chose. */
  rows: readonly ChartRow[];
  /** The top of the value scale; every value is plotted from 0 to this. */
  maxValue?: number;
}

// Layout, in SVG user units (the viewBox scales to the container's width).
const RADAR_WIDTH = 660;
const RADAR_HEIGHT = 560;
const RADAR_CENTER_X = 330;
const RADAR_CENTER_Y = 280;
const RADAR_RADIUS = 150;
/** How far beyond the outer ring the axis labels sit. */
const RADAR_LABEL_GAP = 16;
/** The concentric rings, as fractions of the radius. */
const RADAR_RINGS = [0.25, 0.5, 0.75, 1];
/** Ring levels that carry a visible scale label. */
const RADAR_LABELLED_RINGS = [0.5, 1];

/**
 * Where a series' "n/a" label sits along an axis it has no value on: each
 * series gets its own depth, so several Models missing the same Benchmark
 * never paint their "n/a" labels on top of each other.
 */
const RADAR_MISSING_FRACTIONS = [0.3, 0.46, 0.62, 0.78];

/** A series' accessible label: "<series>: <row> <value|n/a>; …". */
function seriesAriaLabel(label: string, rows: readonly ChartRow[], seriesIndex: number): string {
  const readings = rows.map((row) => {
    const value = row.values[seriesIndex];
    return `${row.label} ${value === undefined ? MISSING : value}`;
  });
  return `${label}: ${readings.join("; ")}`;
}

/** A point on the circle of one axis at a fraction of the radius. */
function radarPoint(axisIndex: number, axisCount: number, fraction: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / axisCount;
  const radius = fraction * RADAR_RADIUS;
  return {
    x: RADAR_CENTER_X + radius * Math.cos(angle),
    y: RADAR_CENTER_Y + radius * Math.sin(angle),
  };
}

export function RadarChart({ ariaLabel, series, rows, maxValue = 100 }: RadarChartProps) {
  const axisCount = rows.length;

  // The compare view never mounts the radar without axes (it shows its
  // "No Benchmarks selected." note instead); guard the degenerate case
  // anyway so the component is safe standalone.
  if (axisCount === 0) {
    return (
      <figure className="radar-chart">
        <ul className="chart-legend">
          {series.map((entry, index) => (
            <li key={entry.label} className={`chart-series-${index % 4}`}>
              <span className="chart-swatch" aria-hidden="true" />
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
      </figure>
    );
  }

  const vertexOf = (axisIndex: number, value: number): { x: number; y: number } =>
    radarPoint(axisIndex, axisCount, Math.min(value, maxValue) / maxValue);

  return (
    <figure className="radar-chart">
      <ul className="chart-legend">
        {series.map((entry, index) => (
          <li key={entry.label} className={`chart-series-${index % 4}`}>
            <span className="chart-swatch" aria-hidden="true" />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
      <svg
        className="radar-chart-svg"
        viewBox={`0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`}
        role="group"
        aria-label={ariaLabel}
      >
        {/* The value scale: a spoke per axis and concentric rings every 25
            units, labelled at 50 and 100 along the top spoke. */}
        <g className="radar-grid" aria-hidden="true">
          {rows.map((row, axisIndex) => {
            const outer = radarPoint(axisIndex, axisCount, 1);
            return (
              <line
                key={row.label}
                x1={RADAR_CENTER_X}
                y1={RADAR_CENTER_Y}
                x2={outer.x}
                y2={outer.y}
              />
            );
          })}
          {RADAR_RINGS.map((ring) => (
            <polygon
              key={ring}
              points={rows
                .map((_, axisIndex) => {
                  const point = radarPoint(axisIndex, axisCount, ring);
                  return `${point.x},${point.y}`;
                })
                .join(" ")}
            />
          ))}
          {RADAR_LABELLED_RINGS.map((ring) => (
            <text
              key={ring}
              x={RADAR_CENTER_X + 6}
              y={RADAR_CENTER_Y - ring * RADAR_RADIUS + 3}
              className="chart-tick"
            >
              {ring * maxValue}
            </text>
          ))}
        </g>

        {/* Axis labels: the row labels around the outer ring. */}
        {rows.map((row, axisIndex) => {
          const labelPoint = radarPoint(axisIndex, axisCount, (RADAR_RADIUS + RADAR_LABEL_GAP) / RADAR_RADIUS);
          const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / axisCount;
          const horizontal = Math.cos(angle);
          const vertical = Math.sin(angle);
          const anchor = horizontal > 0.35 ? "start" : horizontal < -0.35 ? "end" : "middle";
          const dy = vertical < -0.5 ? 0 : vertical > 0.5 ? 12 : 4;
          return (
            <text
              key={row.label}
              x={labelPoint.x}
              y={labelPoint.y + dy}
              textAnchor={anchor}
              className="chart-label"
            >
              {row.label}
            </text>
          );
        })}

        {/* One polygon per series. Consecutive known vertices join with a
            solid segment; when vertices in between are missing, the segment
            runs dashed straight to the next known vertex and each missing
            axis carries an "n/a" label at the series' depth — a missing
            value is never plotted as a zero at the centre. */}
        {series.map((entry, seriesIndex) => {
          const values = rows.map((row) => row.values[seriesIndex]);
          const known = values
            .map((value, axisIndex) =>
              value === undefined ? null : { axisIndex, point: vertexOf(axisIndex, value) },
            )
            .filter((vertex): vertex is { axisIndex: number; point: { x: number; y: number } } => vertex !== null);

          const segments = known.map((from, position) => {
            const to = known[(position + 1) % known.length]!;
            const skipsAxes =
              known.length > 1 && (to.axisIndex - from.axisIndex + axisCount) % axisCount > 1;
            return { from, to, dashed: skipsAxes };
          });

          return (
            <g
              key={entry.label}
              className={`chart-series-${seriesIndex % 4}`}
              role="img"
              aria-label={seriesAriaLabel(entry.label, rows, seriesIndex)}
            >
              {segments.map((segment) => (
                <line
                  key={`${segment.from.axisIndex}-${segment.to.axisIndex}`}
                  x1={segment.from.point.x}
                  y1={segment.from.point.y}
                  x2={segment.to.point.x}
                  y2={segment.to.point.y}
                  className={segment.dashed ? "radar-segment radar-gap" : "radar-segment"}
                />
              ))}
              {known.map((vertex) => (
                <circle
                  key={vertex.axisIndex}
                  cx={vertex.point.x}
                  cy={vertex.point.y}
                  r={3}
                  className="radar-vertex"
                />
              ))}
              {values.map((value, axisIndex) =>
                value === undefined ? (
                  <text
                    key={axisIndex}
                    x={radarPoint(axisIndex, axisCount, RADAR_MISSING_FRACTIONS[seriesIndex % 4]!).x}
                    y={radarPoint(axisIndex, axisCount, RADAR_MISSING_FRACTIONS[seriesIndex % 4]!).y}
                    textAnchor="middle"
                    className="chart-value missing"
                  >
                    {MISSING}
                  </text>
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
