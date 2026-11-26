import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, Model, PricingConfig, Score } from "@llm-bench/schema";
import {
  activeAggregateResult,
  blendedPricePer1M,
  computeAverage,
  computeWeightedAverage,
  defaultSelectedBenchmarkIds,
} from "@llm-bench/scoring";

/**
 * Ticket 11 end-to-end proofs, in the established leaderboard-e2e style:
 * the price/perf chart's data must come from the real Published Results
 * dataset through the scoring package (blended price from the pricing-config
 * data, the active aggregate from the selection and weights), and the built
 * bundle must ship the chart UI's wording. Expected values are hand-computed
 * from packages/data (worked examples from the raw JSON), so a change here
 * is a deliberate data or semantics change, never a silent drift.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_ASSETS = path.join(REPO_ROOT, "apps/web/dist/assets");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
}

function readBuiltBundle(): string {
  const files = readdirSync(DIST_ASSETS);
  return files
    .map((file) => readFileSync(path.join(DIST_ASSETS, file), "utf8"))
    .join("\n");
}

function runBuild(): { status: number | null; output: string } {
  const result = spawnSync("pnpm", ["build"], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe("the price/performance chart over the real dataset", () => {
  const models = readJson<Model[]>("models.json");
  const benchmarks = readJson<Benchmark[]>("benchmarks.json");
  const scores = readJson<Score[]>("scores.json");
  const pricingConfig = readJson<PricingConfig>("pricing-config.json");
  const selection = defaultSelectedBenchmarkIds(benchmarks);

  it("plots exactly the priced Models with an aggregate; the 8 null-priced Models form the separate list", () => {
    // Over the default 12 core Benchmarks every Model has an aggregate, so
    // the plotted set is exactly the 18 priced Models.
    const priced = models.filter((model) => model.inputPricePer1M !== null);
    const plotted = models.filter((model) => {
      const price = blendedPricePer1M(model, pricingConfig);
      const aggregate = activeAggregateResult(model.id, { scores, benchmarkIds: selection });
      return price !== null && aggregate.average !== null;
    });
    expect(priced).toHaveLength(18);
    expect(plotted).toHaveLength(18);
    expect(new Set(plotted.map((model) => model.id))).toEqual(
      new Set(priced.map((model) => model.id)),
    );

    // Hand-listed from models.json: the Models without a public API rate,
    // listed separately under the chart, never plotted.
    const nullPriced = models.filter((model) => model.inputPricePer1M === null);
    expect(nullPriced.map((model) => model.id)).toEqual([
      "gemini-3-pro",
      "deepseek-v4-pro",
      "deepseek-v4-pro-base",
      "deepseek-v4-1-flash",
      "minimax-m2",
      "llama-4-maverick",
      "llama-4-maverick-base",
      "kimi-k2-thinking",
    ]);
  });

  it("reads its numbers from the scoring package — blended prices and active aggregates, hand-checked", () => {
    const byId = (id: string): Model => models.find((model) => model.id === id)!;

    // Hand-computed points on the default selection, Blended price basis:
    // Kimi K3 (3 in / 15 out → blended 6) sits at Average 93.5, Coverage
    // (1/12); GPT-6.2 Astra (8 / 40 → 16) at 97, (1/12); Kimi K2.5
    // (0.5 / 2.5 → 1) at 86.5, (5/12); Claude Opus 4.6 (5 / 25 → 10) at
    // 89.6475 → displays 89.6, (4/12).
    expect(blendedPricePer1M(byId("kimi-k3"), pricingConfig)).toBe(6);
    expect(blendedPricePer1M(byId("gpt-6-2-astra"), pricingConfig)).toBe(16);
    expect(blendedPricePer1M(byId("kimi-k2-5"), pricingConfig)).toBe(1);
    expect(blendedPricePer1M(byId("claude-opus-4-6"), pricingConfig)).toBe(10);

    const kimi = activeAggregateResult("kimi-k3", { scores, benchmarkIds: selection });
    expect(kimi).toEqual({ average: 93.5, coverage: 1, selected: 12 });
    const astra = activeAggregateResult("gpt-6-2-astra", { scores, benchmarkIds: selection });
    expect(astra).toEqual({ average: 97, coverage: 1, selected: 12 });
    const k25 = activeAggregateResult("kimi-k2-5", { scores, benchmarkIds: selection });
    expect(k25.average).toBeCloseTo(86.52, 3);
    expect(k25.coverage).toBe(5);

    // The separate self-hosted list shows the same aggregates as the table:
    // Llama 4 Maverick 64.5667 over 3 → "64.6 (3/12)"; DeepSeek-V4-Pro
    // 87.925 over 4 → "87.9 (4/12)".
    const maverick = activeAggregateResult("llama-4-maverick", { scores, benchmarkIds: selection });
    expect(maverick.average).toBeCloseTo(64.5667, 3);
    expect(maverick.coverage).toBe(3);
    const deepseek = activeAggregateResult("deepseek-v4-pro", { scores, benchmarkIds: selection });
    expect(deepseek.average).toBeCloseTo(87.925, 3);
    expect(deepseek.coverage).toBe(4);
  });

  it("follows the active aggregate: plain Average by default, Weighted Average when a weight is active", () => {
    // Without weights the chart's aggregate is the table's Average.
    for (const model of models) {
      expect(activeAggregateResult(model.id, { scores, benchmarkIds: selection })).toEqual(
        computeAverage(model.id, scores, { benchmarkIds: selection }),
      );
    }

    // Weighting SWE-bench Verified ×2 switches every point to the Weighted
    // Average — hand-checked on Claude Opus 4.6: (91.31 + 99.79 + 91.89 +
    // 2·75.6)/5 = 86.838.
    const weights = { "swebench-verified": 2 };
    const weighted = { scores, benchmarkIds: selection, weights };
    for (const model of models) {
      expect(activeAggregateResult(model.id, weighted)).toEqual(
        computeWeightedAverage(model.id, scores, { benchmarkIds: selection, weights }),
      );
    }
    expect(activeAggregateResult("claude-opus-4-6", weighted).average).toBeCloseTo(86.838, 3);
  });

  it("ships the price/performance chart UI in the built bundle", () => {
    const build = runBuild();
    expect(build.status).toBe(0);

    const bundle = readBuiltBundle();

    // The section, the price-basis selector, and the exact separate-list
    // heading ship. The blended-price ratio itself is read from the data
    // package's pricing config at render time, never hardcoded here.
    expect(bundle).toContain("Price vs performance");
    expect(bundle).toContain("Self-hosted / no public API rate");
    expect(bundle).toContain("Price basis");
    expect(bundle).toContain("Input price / 1M");
    expect(bundle).toContain("Output price / 1M");
    expect(bundle).toContain("Blended price / 1M");

    // The chart's styling hooks, for the browser checks.
    expect(bundle).toContain("price-performance");
    expect(bundle).toContain("scatter-point");
    expect(bundle).toContain("self-hosted-list");
  }, 480_000);
});
