import { useState } from "react";
import { benchmarks, models, scores } from "@llm-bench/data";
import type { Model } from "@llm-bench/schema";
import {
  activeAggregateResult,
  decodeLeaderboardUrlState,
  formatCoverage,
  primaryScoreFor,
  RADAR_AXIS_CAP,
  selectRadarBenchmarks,
  selectedBenchmarks,
  weightsAreActive,
} from "@llm-bench/scoring";
import { BackLink } from "../BackLink";
import { Link } from "../router";
import { benchmarkPath, modelPath } from "../routes";
import { formatOneDecimal } from "../chart-utils";
import { GroupedBarChart, RadarChart } from "../components/GroupedBarChart";

/**
 * The compare view (ticket 10): 2 to 4 Models side by side across the
 * selected Benchmarks. Everything is 100% data-driven and read from the
 * shared URL state — the compared Model ids arrive in the `compare`
 * parameter, the Benchmark selection and weights in the parameters they
 * share with the leaderboard — so a comparison is a shareable link and
 * survives refresh. The view has no controls of its own; selecting Models
 * happens on the leaderboard, and the browser's back button returns there
 * with the whole view intact.
 *
 * Guard rails, not crashes: fewer than 2 or more than 4 compared Models
 * render a friendly message, and ids no Model answers to are dropped with
 * a note (a stale shared link stays honest).
 */

/** Null prices read exactly this — never zero, never a made-up number. */
const NO_PUBLIC_RATE = "self-hosted / no public API rate";

/** The smallest and largest number of Models a comparison shows. */
const MIN_COMPARED = 2;
const MAX_COMPARED = 4;

export function ComparePage() {
  // The view is read-only URL state, decoded once per mount: while the
  // visitor is here the URL does not change, and every navigation remounts
  // the page (the same pattern the leaderboard uses on load).
  const [urlState] = useState(() =>
    decodeLeaderboardUrlState(window.location.search, benchmarks),
  );

  // Resolve the compared Models. A repeated id compares the Model once;
  // an id no Model answers to is dropped, with a note below.
  const uniqueComparedIds = [...new Set(urlState.comparedModelIds)];
  const comparedModels = uniqueComparedIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is Model => model !== undefined);
  const unknownIds = uniqueComparedIds.filter(
    (id) => !models.some((model) => model.id === id),
  );

  // The Benchmark selection and weights come from the shared URL state, so
  // the comparison shows exactly what the visitor selected on the
  // leaderboard — and the aggregate is the active one, computed by the
  // scoring package's shared active-aggregate API (the same one the
  // leaderboard's Average column and ranking use).
  const selection = selectedBenchmarks(benchmarks, urlState.benchmarkIds);
  const leaderboardContext = {
    scores,
    benchmarkIds: urlState.benchmarkIds,
    weights: urlState.weights,
  };
  const weightsActive = weightsAreActive(urlState.weights, urlState.benchmarkIds);
  const aggregateLabel = weightsActive ? "Weighted Average" : "Average";

  // The radar's axes: the deterministic selection from the scoring package
  // (most Primary scores across the compared Models first, capped).
  const radar = selectRadarBenchmarks(
    selection,
    comparedModels.map((model) => model.id),
    scores,
  );
  const radarBenchmarks = radar.benchmarkIds
    .map((id) => selection.find((benchmark) => benchmark.id === id))
    .filter((benchmark) => benchmark !== undefined);
  const deprioritizedNames = radar.deprioritizedBenchmarkIds
    .map((id) => benchmarks.find((benchmark) => benchmark.id === id)?.name ?? id)
    .join(", ");
  const comparedNames = comparedModels.map((model) => model.name).join(", ");

  return (
    <>
      <BackLink />
      <h1>Compare Models</h1>

      {unknownIds.map((id) => (
        <p key={id} className="compare-note">
          No Model with id <code>{id}</code> exists in the data package; it was left out of this
          comparison.
        </p>
      ))}

      {comparedModels.length < MIN_COMPARED ? (
        <p className="page-intro">
          A comparison shows 2 to 4 Models side by side. Select 2 to 4 Models with the Compare
          checkboxes on the leaderboard, then choose Compare selected — the compared Models are
          carried in the link, so it stays shareable.
        </p>
      ) : comparedModels.length > MAX_COMPARED ? (
        <p className="page-intro">
          A comparison shows 2 to 4 Models side by side. This link compares{" "}
          {comparedModels.length} Models — uncheck some on the leaderboard, then compare again.
        </p>
      ) : (
        <>
          <p className="page-intro">
            {comparedModels.length} Models side by side across the {selection.length} selected
            Benchmark{selection.length === 1 ? "" : "s"}, from Primary scores only. Missing values
            read &ldquo;n/a&rdquo;, never zero. The Benchmark selection and weights come from the
            shared URL, so this comparison is shareable and survives refresh.
          </p>

          <section>
            <h2>Side by side</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="text">
                      Model
                    </th>
                    {comparedModels.map((model) => (
                      <th scope="col" key={model.id}>
                        <Link to={modelPath(model.id)}>{model.name}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Provider</th>
                    {comparedModels.map((model) => (
                      <td key={model.id} className="text">
                        {model.provider}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">License</th>
                    {comparedModels.map((model) => (
                      <td key={model.id} className="text">
                        <span>{model.license}</span>
                        {model.licenseName ? (
                          <span className="license-name">{model.licenseName}</span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Context window</th>
                    {comparedModels.map((model) => (
                      <td key={model.id}>
                        {model.contextWindow.toLocaleString("en-US")} tokens
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Input price / 1M</th>
                    {comparedModels.map((model) => (
                      <td key={model.id}>
                        {model.inputPricePer1M === null ? (
                          <span className="missing">{NO_PUBLIC_RATE}</span>
                        ) : (
                          model.inputPricePer1M.toFixed(2)
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Output price / 1M</th>
                    {comparedModels.map((model) => (
                      <td key={model.id}>
                        {model.outputPricePer1M === null ? (
                          <span className="missing">{NO_PUBLIC_RATE}</span>
                        ) : (
                          model.outputPricePer1M.toFixed(2)
                        )}
                      </td>
                    ))}
                  </tr>
                  {/* The active aggregate — the Weighted Average when weights
                      are active on the selection — always with its Coverage
                      as (n/selected), like the leaderboard. */}
                  <tr>
                    <th scope="row">{aggregateLabel}</th>
                    {comparedModels.map((model) => {
                      const result = activeAggregateResult(model.id, leaderboardContext);
                      return (
                        <td key={model.id}>
                          {result.average === null ? (
                            <span className="missing">n/a</span>
                          ) : (
                            formatOneDecimal(result.average)
                          )}{" "}
                          <span className="coverage-count">{formatCoverage(result)}</span>
                        </td>
                      );
                    })}
                  </tr>
                  {/* One row per selected Benchmark, in catalogue order (like
                      the leaderboard's columns): the Primary score per
                      compared Model, "n/a" when missing — never zero. */}
                  {selection.map((benchmark) => (
                    <tr key={benchmark.id}>
                      <th scope="row">
                        <Link to={benchmarkPath(benchmark.id)}>{benchmark.name}</Link>
                      </th>
                      {comparedModels.map((model) => {
                        const score = primaryScoreFor(model.id, benchmark.id, scores);
                        return (
                          <td key={model.id}>
                            {score === undefined ? (
                              <span className="missing">n/a</span>
                            ) : (
                              score.value
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="detail-note">
              The {aggregateLabel} is computed over the {selection.length} selected Benchmark
              {selection.length === 1 ? "" : "s"} from the shared URL, from Primary scores only,
              and is shown with its Coverage as (n/{selection.length}).
            </p>
          </section>

          <section>
            <h2>Radar chart of selected Benchmarks</h2>
            {selection.length === 0 ? (
              <p className="detail-note">No Benchmarks selected.</p>
            ) : (
              <>
                {radar.deprioritizedBenchmarkIds.length > 0 ? (
                  <p className="detail-note">
                    The radar chart is capped at {RADAR_AXIS_CAP} axes, so it shows the selected
                    Benchmarks with the most Primary scores across the compared Models. Not on the
                    radar: {deprioritizedNames}. The bar chart below shows every selected
                    Benchmark.
                  </p>
                ) : null}
                <p className="detail-note">
                  Primary scores only. A dashed segment marks a Model missing a Benchmark; the gap
                  reads &ldquo;n/a&rdquo; on its axis — never zero.
                </p>
                <RadarChart
                  ariaLabel={`Radar chart: ${comparedNames} across ${radarBenchmarks.length} selected Benchmark${radarBenchmarks.length === 1 ? "" : "s"}`}
                  series={comparedModels.map((model) => ({ label: model.name }))}
                  rows={radarBenchmarks.map((benchmark) => ({
                    label: benchmark.name,
                    values: comparedModels.map(
                      (model) => primaryScoreFor(model.id, benchmark.id, scores)?.value,
                    ),
                  }))}
                />
              </>
            )}
          </section>

          <section>
            <h2>Bar chart of all selected Benchmarks</h2>
            {selection.length === 0 ? (
              <p className="detail-note">No Benchmarks selected.</p>
            ) : (
              <>
                <p className="detail-note">
                  Primary scores only. Missing values are shown as &ldquo;n/a&rdquo;, never as
                  zero.
                </p>
                <GroupedBarChart
                  ariaLabel={`Bar chart: ${comparedNames} across all ${selection.length} selected Benchmark${selection.length === 1 ? "" : "s"}`}
                  series={comparedModels.map((model) => ({ label: model.name }))}
                  rows={selection.map((benchmark) => ({
                    label: benchmark.name,
                    values: comparedModels.map(
                      (model) => primaryScoreFor(model.id, benchmark.id, scores)?.value,
                    ),
                  }))}
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
