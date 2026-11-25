import { BackLink } from "../BackLink";
import { benchmarks, models, scores } from "@llm-bench/data";
import { bestValueByBenchmark, modelDataCurrency, primaryScoreFor } from "@llm-bench/scoring";
import { Link } from "../router";
import { benchmarkPath } from "../routes";
import { GroupedBarChart } from "../components/GroupedBarChart";
import { ScorePairDetail } from "../components/ScorePairDetail";
import { sourceHostname } from "../provenance";

/**
 * The Model detail page — 100% data-driven. Everything shown here comes
 * from the Model's record in @llm-bench/data, so adding a Model in the
 * data package creates its page automatically: no per-Model prose, ids, or
 * values are hardcoded in the web app. An unknown id renders the page's
 * own not-found view.
 */

/** Null prices read exactly this — never zero, never a made-up number. */
const NO_PUBLIC_RATE = "self-hosted / no public API rate";

export function ModelPage({ modelId }: { modelId: string }) {
  const model = models.find((candidate) => candidate.id === modelId);

  if (model === undefined) {
    return (
      <>
        <BackLink />
        <h1>Model not found</h1>
        <p>
          No Model with id <code>{modelId}</code> exists in the data package.
        </p>
      </>
    );
  }

  // The current best Primary score per Benchmark, across all Models —
  // the leader each of the Model's Primary scores is compared against.
  const bestByBenchmark = bestValueByBenchmark(scores);

  return (
    <>
      <BackLink />
      <h1>{model.name}</h1>

      {/* The page's data currency: the latest of the Model's lastUpdated
          and its Scores' retrievedDate values (spec "Date semantics"). */}
      <p className="data-currency">Data current as of {modelDataCurrency(model, scores)}</p>
      <dl className="model-facts">
        <div>
          <dt>Provider</dt>
          <dd>{model.provider}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{model.license}</dd>
        </div>
        {model.licenseName === undefined ? null : (
          <div>
            <dt>License name</dt>
            <dd>{model.licenseName}</dd>
          </div>
        )}
        <div>
          <dt>Context window</dt>
          <dd>{model.contextWindow.toLocaleString("en-US")} tokens</dd>
        </div>
        <div>
          <dt>Release date</dt>
          <dd>{model.releaseDate}</dd>
        </div>
        <div>
          <dt>Input price / 1M</dt>
          <dd>
            {model.inputPricePer1M === null ? (
              <span className="missing">{NO_PUBLIC_RATE}</span>
            ) : (
              model.inputPricePer1M.toFixed(2)
            )}
          </dd>
        </div>
        <div>
          <dt>Output price / 1M</dt>
          <dd>
            {model.outputPricePer1M === null ? (
              <span className="missing">{NO_PUBLIC_RATE}</span>
            ) : (
              model.outputPricePer1M.toFixed(2)
            )}
          </dd>
        </div>
        {/* A Reference inference provider is named whenever a third party
            supplies the rate; first-party rates and self-hosted Models
            carry none. */}
        {model.referenceInferenceProvider === null ? null : (
          <div>
            <dt>Reference inference provider</dt>
            <dd>rate from {model.referenceInferenceProvider}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>
            <a href={model.sourceUrl}>{sourceHostname(model.sourceUrl)}</a>
          </dd>
        </div>
      </dl>

      {model.notes === undefined ? null : (
        <section>
          <h2>Notes</h2>
          <p>{model.notes}</p>
        </section>
      )}

      {/* The Model against the Benchmark leaders: the Model's Primary
          score per Benchmark (catalogue order, like the leaderboard's
          columns) against the best Primary score across all Models, from
          the scoring package's best-value API. Missing values render
          "n/a" — never a zero bar. */}
      <section>
        <h2>{model.name} against the Benchmark leaders</h2>
        <p className="detail-note">
          Primary scores only. The “Best across Models” bar is the best Primary score
          across all Models on that Benchmark; missing values are shown as “n/a”, never
          as zero.
        </p>
        <GroupedBarChart
          ariaLabel={`Bar chart: ${model.name} against the best Primary score per Benchmark`}
          series={[{ label: model.name }, { label: "Best across Models" }]}
          rows={benchmarks.map((benchmark) => {
            const primary = primaryScoreFor(model.id, benchmark.id, scores);
            return {
              label: benchmark.name,
              values: [primary?.value, bestByBenchmark.get(benchmark.id)] as const,
            };
          })}
        />
      </section>

      {/* Every Score recorded for this Model, one section per Benchmark
          (in catalogue order, like the leaderboard's columns): ticket 07's
          ScorePairDetail owns the Primary score, the alternate Evaluation
          settings, and the "n/a" sentence for unscored pairs. */}
      <p className="page-intro">
        Every Score recorded for this Model, by Benchmark — the Primary score and any
        alternate Evaluation settings, each with full provenance.
      </p>
      {benchmarks.map((benchmark) => (
        <section key={benchmark.id}>
          <h2>
            <Link to={benchmarkPath(benchmark.id)}>{benchmark.name}</Link>
          </h2>
          <ScorePairDetail model={model} benchmark={benchmark} scores={scores} />
        </section>
      ))}
    </>
  );
}
