import { useMemo } from "react";
import { benchmarks, models, scores } from "@llm-bench/data";
import type { Model, Score } from "@llm-bench/schema";
import { datasetDataCurrency, primaryScoreFor } from "@llm-bench/scoring";
import { Link } from "../router";
import { COMPARE_PATH, modelPath } from "../routes";

/**
 * The landing hero: a glanceable summary of what the leaderboard holds,
 * rendered 100% from the data package like the rest of the view. Every
 * number — Models, Benchmarks, Published Results, Providers, the data
 * currency date, and the "fresh" cards — derives from @llm-bench/data, so
 * a data update changes the hero with no UI edit.
 *
 * The "Fresh Published Results" cards are the newest Models by release
 * date; each card names the Model's best Primary Score so a visitor sees
 * a real, published number (not marketing copy) before they scroll.
 */

/** How many newest Models the fresh-cards strip shows. */
const FRESH_CARD_COUNT = 4;

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Formats an ISO date (YYYY-MM-DD) deterministically in UTC. */
function formatDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

interface FreshModel {
  model: Model;
  bestScore: { score: Score; benchmarkName: string } | null;
}

/** The model's best Primary score with its Benchmark name, or null. */
function bestPrimaryScore(model: Model): FreshModel["bestScore"] {
  let best: { score: Score; benchmarkName: string } | null = null;
  for (const benchmark of benchmarks) {
    const score = primaryScoreFor(model.id, benchmark.id, scores);
    if (score && (!best || score.value > best.score.value)) {
      best = { score, benchmarkName: benchmark.name };
    }
  }
  return best;
}

export function LandingHero() {
  const providerCount = useMemo(
    () => new Set(models.map((model) => model.provider)).size,
    [],
  );
  const freshModels = useMemo<FreshModel[]>(
    () =>
      [...models]
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
        .slice(0, FRESH_CARD_COUNT)
        .map((model) => ({ model, bestScore: bestPrimaryScore(model) })),
    [],
  );
  const dataCurrency = useMemo(() => datasetDataCurrency(models, scores), []);

  return (
    <section className="landing-hero" aria-label="LLM Bench at a glance">
      <div className="hero-copy">
        <p className="hero-tagline">
          The LLM leaderboard that only counts <strong>Published Results</strong> — no
          estimates, no placeholders, every Score traceable to its source.
        </p>
        <ul className="hero-stats" aria-label="Dataset at a glance">
          <li>
            <span className="stat-swatch swatch-blue" aria-hidden="true" />
            <span className="stat-value">{models.length}</span>
            <span className="stat-label">Models</span>
          </li>
          <li>
            <span className="stat-swatch swatch-green" aria-hidden="true" />
            <span className="stat-value">{benchmarks.length}</span>
            <span className="stat-label">Benchmarks</span>
          </li>
          <li>
            <span className="stat-swatch swatch-purple" aria-hidden="true" />
            <span className="stat-value">{scores.length}</span>
            <span className="stat-label">Published Results</span>
          </li>
          <li>
            <span className="stat-swatch swatch-orange" aria-hidden="true" />
            <span className="stat-value">{providerCount}</span>
            <span className="stat-label">Providers</span>
          </li>
        </ul>
        <p className="hero-actions">
          <a className="hero-cta hero-cta-primary" href="#leaderboard-table">
            Explore the leaderboard
          </a>
          <Link className="hero-cta" to={COMPARE_PATH}>
            Compare models
          </Link>
          <a className="hero-cta" href="#price-vs-performance">
            Price vs performance
          </a>
        </p>
        <p className="hero-currency">
          Data current as of {formatDate(dataCurrency)} — sources re-verified on every
          update.
        </p>
      </div>

      <div className="hero-fresh">
        <h2>Fresh Published Results</h2>
        <p className="hero-fresh-intro">
          The newest Models in the dataset, with each one&rsquo;s best Primary Score.
        </p>
        <ul className="fresh-cards">
          {freshModels.map(({ model, bestScore }) => (
            <li key={model.id} className="fresh-card">
              <Link to={modelPath(model.id)} className="fresh-card-link">
                <span className="fresh-card-name">{model.name}</span>
                <span className="fresh-card-provider">{model.provider}</span>
                <span className="fresh-card-date">Released {formatDate(model.releaseDate)}</span>
                {bestScore ? (
                  <span className="fresh-card-score">
                    Best: {bestScore.benchmarkName} {bestScore.score.value}
                  </span>
                ) : (
                  <span className="fresh-card-score">No recorded Score yet</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
