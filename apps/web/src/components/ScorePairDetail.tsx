import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { scoresForPair } from "@llm-bench/scoring";
import { sourceHostname, VERIFIED_EXPLANATION } from "../provenance";

/**
 * The reusable Score provenance view for one Model and Benchmark pair
 * (ticket 07): the Primary score with its full provenance and every
 * alternate Evaluation setting recorded for the pair, each with the same
 * provenance. Every value comes from the data package via scoresForPair —
 * no Model, Benchmark, or provenance prose is hardcoded here.
 *
 * Ticket 09 (Model detail pages) mounts this component per Benchmark on
 * the Model page:
 *
 *     <ScorePairDetail model={model} benchmark={benchmark} scores={scores} />
 *
 * The leaderboard's Score details panel (ScoreDetailDialog) wraps the same
 * component; only the dialog chrome is leaderboard-specific.
 */

interface ScorePairDetailProps {
  model: Model;
  benchmark: Benchmark;
  /** All Scores; the component splits this pair's Scores via scoresForPair. */
  scores: readonly Score[];
}

/** The full provenance of one Score: value, Evaluation setting, source, dates, verified status. */
function ScoreProvenance({ score }: { score: Score }) {
  return (
    <dl className="score-provenance">
      <div>
        <dt>Score</dt>
        <dd>{score.value}</dd>
      </div>
      <div>
        <dt>Evaluation setting</dt>
        <dd>{score.evaluationSetting}</dd>
      </div>
      <div>
        <dt>Source type</dt>
        <dd>{score.sourceType}</dd>
      </div>
      <div>
        <dt>Source URL</dt>
        <dd>
          <a href={score.sourceUrl}>{sourceHostname(score.sourceUrl)}</a>
        </dd>
      </div>
      <div>
        <dt>publishedDate</dt>
        <dd>{score.publishedDate}</dd>
      </div>
      <div>
        <dt>retrievedDate</dt>
        <dd>{score.retrievedDate}</dd>
      </div>
      <div>
        <dt>Verified</dt>
        <dd>{score.verified ? "yes" : "no"}</dd>
      </div>
    </dl>
  );
}

export function ScorePairDetail({ model, benchmark, scores }: ScorePairDetailProps) {
  const { primary, alternates } = scoresForPair(model.id, benchmark.id, scores);

  if (primary === undefined) {
    return (
      <p>
        <span className="missing">n/a</span> — no Scores have been published for {model.name} on{" "}
        {benchmark.name}.
      </p>
    );
  }

  return (
    <>
      <section>
        <h3>Primary score</h3>
        <ScoreProvenance score={primary} />
      </section>
      {alternates.length > 0 ? (
        <section>
          <h3>Alternate Evaluation setting{alternates.length === 1 ? "" : "s"}</h3>
          <p className="detail-note">
            Excluded from the Average, best-Score highlighting, and charts — only the Primary
            score is used.
          </p>
          <ul className="alternate-scores">
            {alternates.map((score) => (
              <li key={score.evaluationSetting}>
                <ScoreProvenance score={score} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="detail-note verified-note">Verified means {VERIFIED_EXPLANATION}.</p>
    </>
  );
}
