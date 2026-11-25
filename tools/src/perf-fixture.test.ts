import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ModelSchema, ScoreSchema } from "@llm-bench/schema";
import { PERF_FIXTURE_MODEL_COUNT, writePerfFixture } from "./lib/perf-fixture";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The ticket-13 performance fixture (ticket spec: "the leaderboard stays
 * responsive with 200+ Models loaded"): a synthetic dataset of 220 Models
 * and their Scores, written ONLY into a temporary directory — the real data
 * package keeps real Published Results exclusively (and its zero-placeholder
 * pin stays green because this fixture never touches packages/data).
 *
 * The fixture is schema-conformant by construction: every synthetic Model
 * and Score parses against @llm-bench/schema, every Score references a real
 * Benchmark id from the real catalogue, and every Evaluation setting comes
 * from the real controlled vocabulary.
 */

const fixtureDir = mkdtempSync(path.join(tmpdir(), "llm-bench-perf-fixture-test-"));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("the 220-Model performance fixture (ticket 13)", () => {
  it("writes a schema-conformant synthetic dataset into a temp directory only", () => {
    writePerfFixture(fixtureDir);

    const models = JSON.parse(readFileSync(path.join(fixtureDir, "models.json"), "utf8"));
    const scores = JSON.parse(readFileSync(path.join(fixtureDir, "scores.json"), "utf8"));

    // 200+ Models, and exactly the promised count.
    expect(models.length).toBe(PERF_FIXTURE_MODEL_COUNT);
    expect(models.length).toBeGreaterThanOrEqual(200);

    // Every synthetic Model parses against the real schema (price invariant
    // included).
    for (const model of models) {
      expect(() => ModelSchema.parse(model)).not.toThrow();
    }

    // Every synthetic Score parses, references a real Benchmark id and one
    // of the real Models, uses the real Evaluation-setting vocabulary, and
    // is a Primary score (exactly one per Model/Benchmark pair).
    const benchmarkIds = new Set(
      JSON.parse(readFileSync(path.join(fixtureDir, "benchmarks.json"), "utf8")).map(
        (benchmark: { id: string }) => benchmark.id,
      ),
    );
    const vocabulary = new Set(
      JSON.parse(readFileSync(path.join(fixtureDir, "evaluation-settings.json"), "utf8")).map(
        (setting: { name: string }) => setting.name,
      ),
    );
    const modelIds = new Set(models.map((model: { id: string }) => model.id));
    const pairs = new Set<string>();
    expect(scores.length).toBeGreaterThan(PERF_FIXTURE_MODEL_COUNT);
    for (const score of scores) {
      expect(() => ScoreSchema.parse(score)).not.toThrow();
      expect(benchmarkIds.has(score.benchmarkId)).toBe(true);
      expect(modelIds.has(score.modelId)).toBe(true);
      expect(vocabulary.has(score.evaluationSetting)).toBe(true);
      expect(score.isPrimary).toBe(true);
      pairs.add(`${score.modelId}|${score.benchmarkId}`);
    }
    expect(pairs.size).toBe(scores.length);

    // The catalogue and vocabulary files are the real ones, byte-identical.
    const dataDir = path.join(REPO_ROOT, "packages/data");
    for (const file of ["benchmarks.json", "evaluation-settings.json", "pricing-config.json"]) {
      expect(readFileSync(path.join(fixtureDir, file), "utf8")).toBe(
        readFileSync(path.join(dataDir, file), "utf8"),
      );
    }

    // The data-package module shim exists so a build can alias
    // @llm-bench/data at it.
    expect(existsSync(path.join(fixtureDir, "index.ts"))).toBe(true);
  });

  it("is reproducible: two generations produce identical bytes", () => {
    writePerfFixture(fixtureDir);
    const first = readFileSync(path.join(fixtureDir, "models.json"), "utf8");
    const firstScores = readFileSync(path.join(fixtureDir, "scores.json"), "utf8");

    writePerfFixture(fixtureDir);
    expect(readFileSync(path.join(fixtureDir, "models.json"), "utf8")).toBe(first);
    expect(readFileSync(path.join(fixtureDir, "scores.json"), "utf8")).toBe(firstScores);
  });

  it("never writes anything into the real data package", () => {
    const dataDir = path.join(REPO_ROOT, "packages/data");
    const before = readFileSync(path.join(dataDir, "models.json"), "utf8");
    writePerfFixture(fixtureDir);
    expect(readFileSync(path.join(dataDir, "models.json"), "utf8")).toBe(before);
    // The fixture Models themselves must be unmistakably synthetic.
    const models = JSON.parse(readFileSync(path.join(fixtureDir, "models.json"), "utf8"));
    expect(models.every((model: { name: string }) => model.name.includes("Perf Fixture"))).toBe(
      true,
    );
    expect(JSON.parse(readFileSync(path.join(dataDir, "models.json"), "utf8")).length).toBeLessThan(
      200,
    );
  });
});
