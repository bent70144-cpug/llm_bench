import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, EvaluationSetting, Model, Score } from "@llm-bench/schema";

/**
 * The Published Results dataset contract (ticket 04): real, verified published
 * numbers for 20+ Models with complete provenance, exactly one Primary score
 * per (Model, Benchmark) pair, competition between Sources resolved through
 * each Benchmark's Canonical sources (or the documented tie-break), and every
 * Evaluation setting drawn from the controlled vocabulary.
 *
 * These are dataset facts `pnpm validate` already enforces structurally (the
 * one-Primary rule, vocabulary membership, Canonical-sources eligibility);
 * they are pinned here against the real composition so a regression in a
 * future data PR fails a named test, not a generic validator message.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");

function readDataFile<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, fileName), "utf8")) as T;
}

const models = readDataFile<Model[]>("models.json");
const benchmarks = readDataFile<Benchmark[]>("benchmarks.json");
const scores = readDataFile<Score[]>("scores.json");
const evaluationSettings = readDataFile<EvaluationSetting[]>("evaluation-settings.json");

const coreBenchmarkIds = new Set(benchmarks.filter((b) => b.tier === "core").map((b) => b.id));

function scoresFor(modelId: string, benchmarkId: string): Score[] {
  return scores.filter((s) => s.modelId === modelId && s.benchmarkId === benchmarkId);
}

function primaryAmong(candidates: readonly Score[]): Score | undefined {
  return candidates.find((score) => score.isPrimary);
}

describe("the Published Results dataset in packages/data (ticket 04)", () => {
  it("has at least 20 Models, each with a verified Primary Score on a core Benchmark", () => {
    expect(models.length).toBeGreaterThanOrEqual(20);

    const sparse: string[] = [];
    for (const model of models) {
      const qualifying = scores.filter(
        (score) =>
          score.modelId === model.id &&
          score.isPrimary &&
          score.verified &&
          coreBenchmarkIds.has(score.benchmarkId),
      );
      if (qualifying.length === 0) {
        sparse.push(model.id);
      }
    }
    expect(sparse).toEqual([]);
  });

  it("marks exactly one Primary score for every (Model, Benchmark) pair that has Scores", () => {
    const pairs = new Map<string, Score[]>();
    for (const score of scores) {
      const pair = `${score.modelId}|${score.benchmarkId}`;
      pairs.set(pair, [...(pairs.get(pair) ?? []), score]);
    }
    expect(pairs.size).toBeGreaterThan(0);

    for (const [pair, pairScores] of pairs) {
      const primaries = pairScores.filter((score) => score.isPrimary);
      expect(
        primaries.length,
        `pair ${pair}: expected exactly 1 Primary score, found ${primaries.length}`,
      ).toBe(1);
    }
  });

  it("resolves the claude-opus-4-5 SWE-bench Verified competition by Canonical sources, not by value", () => {
    // Real competing Published Results: Anthropic's self-reported scaffold
    // rows (80.9 without thinking, 80.6 with) are HIGHER than the official
    // swebench.com mini-SWE-agent row (74.4). swebench-verified ranks the
    // leaderboard first in Canonical sources, so the leaderboard Score is the
    // Primary score despite the lower value.
    const competing = scoresFor("claude-opus-4-5", "swebench-verified");
    expect(competing.length).toBe(3);

    const benchmark = benchmarks.find((b) => b.id === "swebench-verified");
    expect(benchmark?.canonicalSources[0]).toEqual({
      sourceType: "leaderboard",
      urlPatterns: ["swebench.com"],
    });

    const primary = primaryAmong(competing);
    expect(primary).toBeDefined();
    expect(primary?.sourceType).toBe("leaderboard");
    expect(primary?.sourceUrl).toMatch(/swebench\.com/);
    expect(primary?.value).toBe(74.4);
    expect(primary?.evaluationSetting).toBe("pass@1 (mini-SWE-agent)");

    for (const alternate of competing.filter((score) => score !== primary)) {
      expect(alternate.isPrimary).toBe(false);
      expect(alternate.sourceType).toBe("provider");
      expect(alternate.value).toBeGreaterThan(primary!.value);
    }
  });

  it("resolves the claude-opus-4-6 τ²-bench tie by the documented Retail-domain tie-break", () => {
    // Both provider rows come from the same system card (same Source type,
    // same publishedDate), so the Canonical-sources rank and newest-date
    // tie-breaks are inconclusive. The official taubench.com leaderboard has
    // no Standard/core Overall row for this Model (verified 2026-11-26), so
    // the documented deterministic tie-break applies: the Retail domain —
    // τ²-bench's original domain — is the Primary score, even though the
    // Telecom value is higher.
    const competing = scoresFor("claude-opus-4-6", "tau2-bench");
    expect(competing.length).toBe(2);

    const retail = competing.find((score) => score.value === 91.89);
    const telecom = competing.find((score) => score.value === 99.25);
    expect(retail?.evaluationSetting).toBe("pass^1 (Retail domain)");
    expect(telecom?.evaluationSetting).toBe("pass^1 (Telecom domain)");
    expect(retail?.sourceType).toBe("provider");
    expect(telecom?.sourceType).toBe("provider");
    expect(retail?.publishedDate).toBe(telecom?.publishedDate);

    expect(retail?.isPrimary).toBe(true);
    expect(telecom?.isPrimary).toBe(false);
  });

  it("keeps every Score's Evaluation setting inside the controlled vocabulary", () => {
    const vocabulary = new Set(evaluationSettings.map((setting) => setting.name));
    expect(vocabulary.size).toBe(evaluationSettings.length); // no duplicate names

    for (const score of scores) {
      expect(
        vocabulary.has(score.evaluationSetting),
        `Score ${score.modelId} on ${score.benchmarkId} uses "${score.evaluationSetting}"`,
      ).toBe(true);
    }
  });

  it("contains only Scores verified against their linked source (no placeholder or estimated data)", () => {
    for (const score of scores) {
      expect(score.verified, `Score ${score.modelId} on ${score.benchmarkId}`).toBe(true);
      expect(score.sourceUrl).toMatch(/^https:\/\//);
      expect(score.publishedDate <= score.retrievedDate).toBe(true);
    }
  });
});
