import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Benchmark, License, Model, Score } from "@llm-bench/schema";

/**
 * The ticket-13 performance fixture: a synthetic 220-Model dataset for
 * measuring the leaderboard's responsiveness at scale ("200+ Models
 * loaded", user story 54).
 *
 * Rules this fixture lives by:
 * - It is written ONLY into a temporary directory chosen by the caller.
 *   The real data package (@llm-bench/data) keeps real Published Results
 *   exclusively; nothing here ever lands in packages/data.
 * - It is synthetic and says so: every Model name starts with
 *   "Perf Fixture", every source URL is on the reserved example.com domain
 *   (documentation-only, never fetched), and no Score claims to be
 *   verified.
 * - It is schema-conformant: Models satisfy the price invariant, Scores
 *   reference real Benchmark ids from the real catalogue and Evaluation
 *   settings from the real controlled vocabulary, and there is exactly one
 *   Primary score per Model/Benchmark pair.
 * - It is deterministic: a fixed seed drives every choice, so two
 *   generations produce byte-identical files and measurements can be
 *   compared across runs.
 *
 * The Benchmarks, the Evaluation-setting vocabulary, and the pricing
 * configuration are copied byte-identical from the real data package — the
 * fixture varies Model/Score volume, not the catalogue.
 */

/** 220 synthetic Models — comfortably above the "200+" story. */
export const PERF_FIXTURE_MODEL_COUNT = 220;

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");

/** Evaluation settings used by the synthetic Scores (must exist in the real vocabulary). */
const FIXTURE_EVALUATION_SETTINGS = ["0-shot", "3-shot", "5-shot", "0-shot CoT"] as const;

/** A tiny deterministic PRNG (mulberry32) — reproducibility by construction. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** The module shim a fixture build aliases `@llm-bench/data` at. */
const FIXTURE_MODULE_SOURCE = `/**
 * Synthetic performance fixture (ticket 13) — generated, NEVER part of
 * packages/data. This module mirrors the real @llm-bench/data exports so a
 * Vite build can alias the package at this directory (LLM_BENCH_DATA_DIR).
 */
import benchmarksJson from "./benchmarks.json";
import evaluationSettingsJson from "./evaluation-settings.json";
import modelsJson from "./models.json";
import pricingConfigJson from "./pricing-config.json";
import scoresJson from "./scores.json";

export const models = modelsJson;
export const benchmarks = benchmarksJson;
export const scores = scoresJson;
export const evaluationSettings = evaluationSettingsJson;
export const pricingConfig = pricingConfigJson;
`;

/**
 * Writes the fixture into `dir` (models.json, scores.json, the
 * benchmark/evaluation-settings/pricing-config files copied from the real
 * data package, and an index.ts module shim that a build can alias
 * `@llm-bench/data` at). Overwrites existing files, so regenerating is
 * idempotent.
 */
export function writePerfFixture(dir: string): void {
  const benchmarks = readJson<Benchmark[]>(path.join(DATA_DIR, "benchmarks.json"));
  const vocabulary = new Set(
    readJson<{ name: string }[]>(path.join(DATA_DIR, "evaluation-settings.json")).map(
      (setting) => setting.name,
    ),
  );
  for (const setting of FIXTURE_EVALUATION_SETTINGS) {
    if (!vocabulary.has(setting)) {
      throw new Error(
        `The real Evaluation-setting vocabulary lacks "${setting}", which the perf fixture uses.`,
      );
    }
  }

  // Only core-Tier Benchmarks carry synthetic Primary scores: the leaderboard
  // shows them under the default selection, so the rendered table is at its
  // widest — every Model row, every core column.
  const coreBenchmarkIds = benchmarks
    .filter((benchmark) => benchmark.tier === "core")
    .map((benchmark) => benchmark.id);

  const providers = [
    "SynthAI",
    "Fixture Labs",
    "Meridian Models",
    "Northbridge AI",
    "Cassini Computing",
    "Halcyon Research",
    "Ardent Systems",
    "Lumen Cognition",
  ];
  const licenses: License[] = ["proprietary", "open-weights", "open-source"];
  const contextWindows = [32_768, 65_536, 131_072, 200_000, 256_000, 1_000_000, 2_000_000];

  const random = createRandom(13);
  const models: Model[] = [];
  const scores: Score[] = [];

  for (let index = 1; index <= PERF_FIXTURE_MODEL_COUNT; index++) {
    const id = `perf-fixture-model-${String(index).padStart(3, "0")}`;
    const license = licenses[index % licenses.length]!;
    const priced = license === "proprietary" || random() < 0.5;
    const model: Model = {
      id,
      name: `Perf Fixture Model ${String(index).padStart(3, "0")}`,
      provider: providers[index % providers.length]!,
      license,
      ...(license === "proprietary"
        ? {}
        : { licenseName: `${license === "open-weights" ? "Open Weights" : "Apache-2.0"} (fixture)` }),
      releaseDate: "2026-03-01",
      contextWindow: contextWindows[index % contextWindows.length]!,
      inputPricePer1M: priced ? Number((random() * 20).toFixed(2)) : null,
      outputPricePer1M: priced ? Number((random() * 60).toFixed(2)) : null,
      referenceInferenceProvider:
        priced && index % 7 === 0 ? "Example Reference inference provider" : null,
      lastUpdated: "2026-06-01",
      sourceUrl: `https://example.com/perf-fixture/${id}`,
    };
    models.push(model);

    // 3–12 core Benchmarks per Model: most Models are sparse, like the real
    // catalogue — a few well measured, many partial.
    const coverage = 3 + Math.floor(random() * (coreBenchmarkIds.length - 2));
    const benchmarkOrder = [...coreBenchmarkIds];
    for (let shuffle = benchmarkOrder.length - 1; shuffle > 0; shuffle--) {
      const swap = Math.floor(random() * (shuffle + 1));
      [benchmarkOrder[shuffle], benchmarkOrder[swap]] = [
        benchmarkOrder[swap]!,
        benchmarkOrder[shuffle]!,
      ];
    }
    for (const benchmarkId of benchmarkOrder.slice(0, coverage)) {
      scores.push({
        modelId: id,
        benchmarkId,
        value: Number((40 + random() * 59.9).toFixed(1)),
        evaluationSetting:
          FIXTURE_EVALUATION_SETTINGS[Math.floor(random() * FIXTURE_EVALUATION_SETTINGS.length)]!,
        sourceType: "provider",
        sourceUrl: `https://example.com/perf-fixture/${id}/${benchmarkId}`,
        publishedDate: "2026-06-15",
        retrievedDate: "2026-06-20",
        verified: false,
        isPrimary: true,
      });
    }
  }

  writeJson(path.join(dir, "models.json"), models);
  writeJson(path.join(dir, "scores.json"), scores);
  for (const file of ["benchmarks.json", "evaluation-settings.json", "pricing-config.json"]) {
    copyFileSync(path.join(DATA_DIR, file), path.join(dir, file));
  }
  writeFileSync(path.join(dir, "index.ts"), FIXTURE_MODULE_SOURCE);
}
