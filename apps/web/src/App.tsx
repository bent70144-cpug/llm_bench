import { benchmarks, models, scores } from "@llm-bench/data";
import { bestValueByBenchmark, computeAverage, primaryScoreFor } from "@llm-bench/scoring";

/**
 * The leaderboard renders 100% from the data package: every row, column,
 * and number below derives from @llm-bench/data via @llm-bench/scoring.
 * Tier drives the default Benchmark selection — core Benchmarks are selected.
 */
const selectedBenchmarks = benchmarks.filter((benchmark) => benchmark.tier === "core");
const selectedBenchmarkIds = selectedBenchmarks.map((benchmark) => benchmark.id);
const bestByBenchmark = bestValueByBenchmark(scores);

function formatAverage(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function App() {
  return (
    <main>
      <h1>LLM Bench</h1>
      <p className="page-intro">
        Published Results only: every Score is a real number from a Provider, a paper, a
        leaderboard, or a third-party report. Benchmarks in the core Tier are selected by
        default.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Provider</th>
              <th scope="col">License</th>
              <th scope="col">Average</th>
              <th scope="col">Coverage</th>
              {selectedBenchmarks.map((benchmark) => (
                <th key={benchmark.id} scope="col">
                  {benchmark.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const { average, coverage, selected } = computeAverage(model.id, scores, {
                benchmarkIds: selectedBenchmarkIds,
              });
              return (
                <tr key={model.id}>
                  <th scope="row">{model.name}</th>
                  <td>{model.provider}</td>
                  <td>
                    <span>{model.license}</span>
                    {model.licenseName ? <span className="license-name">{model.licenseName}</span> : null}
                  </td>
                  <td>{average === null ? <span className="missing">n/a</span> : formatAverage(average)}</td>
                  <td>
                    ({coverage}/{selected})
                  </td>
                  {selectedBenchmarks.map((benchmark) => {
                    const score = primaryScoreFor(model.id, benchmark.id, scores);
                    const isBest = score !== undefined && score.value === bestByBenchmark.get(benchmark.id);
                    return (
                      <td key={benchmark.id} className={isBest ? "best" : undefined}>
                        {score === undefined ? (
                          <span className="missing">n/a</span>
                        ) : (
                          <a
                            href={score.sourceUrl}
                            title={`Source type: ${score.sourceType} · Evaluation setting: ${score.evaluationSetting} · publishedDate ${score.publishedDate} · retrievedDate ${score.retrievedDate}`}
                          >
                            {score.value}
                          </a>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Missing Scores are shown as &ldquo;n/a&rdquo;, never as zero. Each Score links to its
        published source.
      </p>
    </main>
  );
}

export default App;
