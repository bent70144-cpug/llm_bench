import { BackLink } from "../BackLink";
import { benchmarks, models, scores } from "@llm-bench/data";
import { bestValueByBenchmark, primaryScoreFor } from "@llm-bench/scoring";
import { sourceHostname } from "../provenance";

/**
 * The Benchmark detail page — 100% data-driven. Everything shown here comes
 * from the Benchmark's record in @llm-bench/data, so adding a Benchmark in
 * the data package creates its page automatically: no per-Benchmark prose,
 * ids, or columns are hardcoded in the web app. An unknown id renders the
 * page's own not-found view.
 */

export function BenchmarkPage({ benchmarkId }: { benchmarkId: string }) {
  const benchmark = benchmarks.find((candidate) => candidate.id === benchmarkId);

  if (benchmark === undefined) {
    return (
      <>
        <BackLink />
        <h1>Benchmark not found</h1>
        <p>
          No Benchmark with id <code>{benchmarkId}</code> exists in the data package.
        </p>
      </>
    );
  }

  // The current best Score on this Benchmark, from Primary scores only
  // (bestValueByBenchmark ignores alternate Evaluation settings).
  const bestValue = bestValueByBenchmark(scores).get(benchmark.id);
  const leaders =
    bestValue === undefined
      ? []
      : models.flatMap((model) => {
          const score = primaryScoreFor(model.id, benchmark.id, scores);
          return score !== undefined && score.value === bestValue ? [{ model, score }] : [];
        });

  return (
    <>
      <BackLink />
      <h1>{benchmark.name}</h1>

      <dl className="benchmark-facts">
        <div>
          <dt>Category</dt>
          <dd>{benchmark.category}</dd>
        </div>
        <div>
          <dt>Tier</dt>
          <dd>{benchmark.tier}</dd>
        </div>
        <div>
          <dt>Metric</dt>
          <dd>{benchmark.metric}</dd>
        </div>
        <div>
          <dt>Scale</dt>
          <dd>0–100, {benchmark.higherIsBetter ? "higher is better" : "lower is better"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            <a href={benchmark.sourceUrl}>{sourceHostname(benchmark.sourceUrl)}</a>
          </dd>
        </div>
      </dl>

      <p className="page-intro">{benchmark.description}</p>

      <section>
        <h2>Limitations</h2>
        <p>{benchmark.limitations}</p>
      </section>

      <section>
        <h2>Evaluation setting notes</h2>
        <p>{benchmark.evaluationSettingNotes}</p>
      </section>

      <section>
        <h2>Canonical sources</h2>
        <p>
          When more than one Published Result exists for a Model on this Benchmark, the
          highest-ranked eligible Source type below wins; ties break by the newest
          publishedDate.
        </p>
        <ol className="canonical-sources">
          {benchmark.canonicalSources.map((source) => (
            <li key={source.sourceType}>
              {source.sourceType}
              {source.urlPatterns === undefined ? null : (
                <span className="url-patterns">
                  {" "}
                  (sourceUrl must match: {source.urlPatterns.join(", ")})
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Current best Score</h2>
        {leaders.length === 0 ? (
          <p>
            <span className="missing">n/a</span> — no Primary scores have been published
            for this Benchmark yet.
          </p>
        ) : (
          <ul className="best-scores">
            {leaders.map(({ model, score }) => (
              <li key={model.id}>
                <strong>{model.name}</strong> — {score.value} ({score.evaluationSetting}),{" "}
                <a href={score.sourceUrl}>source</a> (Source type: {score.sourceType},
                publishedDate {score.publishedDate})
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
