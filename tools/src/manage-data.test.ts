import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupTempDirs,
  DATA_FILE_NAMES,
  readDataFile,
  readRawDataFile,
  runManage,
  runValidate,
  writeFixture,
} from "./cli-test-utils";

/**
 * Seam 2: the manage-data CRUD CLI is invoked as a process against
 * temporary fixture data. The contract under test: exit codes, messages,
 * and the JSON it writes — every mutation validates before writing, so
 * invalid input must leave all files byte-identical.
 */

afterAll(cleanupTempDirs);

/** A schema-valid Model absent from the base fixture. */
const MODEL_B = {
  id: "model-b",
  name: "Model B",
  provider: "Provider B",
  license: "open-weights",
  releaseDate: "2026-02-10",
  contextWindow: 256000,
  inputPricePer1M: 1.0,
  outputPricePer1M: 4.0,
  referenceInferenceProvider: null,
  lastUpdated: "2026-02-20",
  sourceUrl: "https://example.com/model-b",
};

/** A schema-valid Score for Model B on the fixture Benchmark. */
const SCORE_MODEL_B = {
  modelId: "model-b",
  benchmarkId: "bench-1",
  value: 81.5,
  evaluationSetting: "5-shot",
  sourceType: "provider",
  sourceUrl: "https://example.com/model-b",
  publishedDate: "2026-02-15",
  retrievedDate: "2026-02-20",
  verified: true,
  isPrimary: true,
};

function snapshotFiles(dir: string): Record<string, string> {
  return Object.fromEntries(DATA_FILE_NAMES.map((name) => [name, readRawDataFile(dir, name)]));
}

function expectUnchanged(dir: string, snapshot: Record<string, string>): void {
  for (const name of DATA_FILE_NAMES) {
    expect(readRawDataFile(dir, name)).toBe(snapshot[name]);
  }
}

describe("manage-data CLI", () => {
  describe("help and usage", () => {
    it("prints documented usage with --help and exits 0", () => {
      const result = runManage(["--help"]);

      expect(result.status).toBe(0);
      expect(result.output).toContain("add model");
      expect(result.output).toContain("edit score");
      expect(result.output).toContain("delete model");
      expect(result.output).toContain("--cascade");
    });

    it("exits 2 with usage when invoked without a command", () => {
      const result = runManage([]);

      expect(result.status).toBe(2);
      expect(result.output).toContain("usage");
    });

    it("exits 2 when add model is called without --json", () => {
      const dir = writeFixture();

      const result = runManage(["add", "model"], dir);

      expect(result.status).toBe(2);
      expect(result.output).toContain("--json");
    });
  });

  describe("add", () => {
    it("adds a Model, updates models.json, and leaves the data directory valid", () => {
      const dir = writeFixture();

      const result = runManage(["add", "model", "--json", JSON.stringify(MODEL_B)], dir);

      expect(result.status).toBe(0);
      const models = readDataFile<Array<{ id: string }>>(dir, "models.json");
      expect(models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
      expect(runValidate(dir).status).toBe(0);
    });

    it("adds a Benchmark and leaves the data directory valid", () => {
      const dir = writeFixture();
      const benchmark = {
        id: "bench-2",
        name: "Bench 2",
        category: "knowledge",
        description: "A knowledge Benchmark.",
        metric: "Accuracy (percent correct)",
        higherIsBetter: true,
        tier: "extended",
        sourceUrl: "https://example.com/bench-2",
        canonicalSources: [{ sourceType: "paper" }],
        limitations: "None documented.",
        evaluationSettingNotes: "5-shot default.",
      };

      const result = runManage(["add", "benchmark", "--json", JSON.stringify(benchmark)], dir);

      expect(result.status).toBe(0);
      const benchmarks = readDataFile<Array<{ id: string }>>(dir, "benchmarks.json");
      expect(benchmarks.map((benchmark) => benchmark.id)).toEqual(["bench-1", "bench-2"]);
      expect(runValidate(dir).status).toBe(0);
    });

    it("adds a Score for a new Model and leaves the data directory valid", () => {
      const dir = writeFixture();
      runManage(["add", "model", "--json", JSON.stringify(MODEL_B)], dir);

      const result = runManage(["add", "score", "--json", JSON.stringify(SCORE_MODEL_B)], dir);

      expect(result.status).toBe(0);
      const scores = readDataFile<Array<{ modelId: string }>>(dir, "scores.json");
      expect(scores).toHaveLength(2);
      expect(runValidate(dir).status).toBe(0);
    });

    it("adds a non-primary Score under an alternate Evaluation setting", () => {
      const dir = writeFixture({
        "evaluation-settings.json": [
          { name: "5-shot", description: "Five-shot prompting." },
          { name: "0-shot", description: "Zero-shot prompting." },
        ],
      });

      // Same-rank provider Score published before the fixture Primary
      // (2026-01-10): a newer same-ranked Score would have to be the
      // Primary under the Source resolution rule.
      const result = runManage(
        [
          "add",
          "score",
          "--json",
          JSON.stringify({
            modelId: "model-a",
            benchmarkId: "bench-1",
            value: 60,
            evaluationSetting: "0-shot",
            sourceType: "provider",
            sourceUrl: "https://example.com/model-a",
            publishedDate: "2026-01-05",
            retrievedDate: "2026-02-01",
            verified: true,
            isPrimary: false,
          }),
        ],
        dir,
      );

      expect(result.status).toBe(0);
      const scores = readDataFile<Array<{ evaluationSetting: string }>>(dir, "scores.json");
      expect(scores.map((score) => score.evaluationSetting).sort()).toEqual(["0-shot", "5-shot"]);
      expect(runValidate(dir).status).toBe(0);
    });

    it("refuses an invalid Model and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["add", "model", "--json", JSON.stringify({ ...MODEL_B, license: "source-available" })],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("model-b");
      expect(result.output).toContain("license");
      expectUnchanged(dir, snapshot);
    });

    it("refuses a Model with an unknown field and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["add", "model", "--json", JSON.stringify({ ...MODEL_B, licenceName: "MIT License" })],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("licenceName");
      expectUnchanged(dir, snapshot);
    });

    it("refuses a Model whose id already exists and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["add", "model", "--json", JSON.stringify({ ...MODEL_B, id: "model-a" })],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("already exists");
      expectUnchanged(dir, snapshot);
    });

    it("refuses a Score referencing an unknown Model and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["add", "score", "--json", JSON.stringify({ ...SCORE_MODEL_B, modelId: "no-such-model" })],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("no-such-model");
      expectUnchanged(dir, snapshot);
    });

    it("refuses a second Primary score for a pair that already has one and writes nothing", () => {
      const dir = writeFixture({
        "evaluation-settings.json": [
          { name: "5-shot", description: "Five-shot prompting." },
          { name: "0-shot", description: "Zero-shot prompting." },
        ],
      });
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        [
          "add",
          "score",
          "--json",
          JSON.stringify({
            ...SCORE_MODEL_B,
            modelId: "model-a",
            evaluationSetting: "0-shot",
            isPrimary: true,
          }),
        ],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("Primary");
      expectUnchanged(dir, snapshot);
    });

    it("refuses a Score that duplicates an existing (Model, Benchmark, Evaluation setting) triple", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        [
          "add",
          "score",
          "--json",
          JSON.stringify({ ...SCORE_MODEL_B, modelId: "model-a", value: 90 }),
        ],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("already exists");
      expectUnchanged(dir, snapshot);
    });
  });

  describe("edit", () => {
    it("edits a Score value and leaves the data directory valid", () => {
      const dir = writeFixture();

      const result = runManage(
        ["edit", "score", "model-a", "bench-1", "5-shot", "--json", '{"value": 78.5}'],
        dir,
      );

      expect(result.status).toBe(0);
      const scores = readDataFile<Array<{ value: number }>>(dir, "scores.json");
      expect(scores).toHaveLength(1);
      expect(scores[0]?.value).toBe(78.5);
      expect(runValidate(dir).status).toBe(0);
    });

    it("refuses an invalid Score edit and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["edit", "score", "model-a", "bench-1", "5-shot", "--json", '{"value": 150}'],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("model-a on bench-1");
      expectUnchanged(dir, snapshot);
    });

    it("exits non-zero when the Score to edit does not exist", () => {
      const dir = writeFixture();

      const result = runManage(
        ["edit", "score", "model-a", "bench-1", "0-shot", "--json", '{"value": 78.5}'],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("0-shot");
    });

    it("edits Model prices and leaves the data directory valid", () => {
      const dir = writeFixture();

      const result = runManage(
        ["edit", "model", "model-a", "--json", '{"inputPricePer1M": 2.5, "outputPricePer1M": 5.0}'],
        dir,
      );

      expect(result.status).toBe(0);
      const models = readDataFile<Array<{ inputPricePer1M: number }>>(dir, "models.json");
      expect(models[0]?.inputPricePer1M).toBe(2.5);
      expect(runValidate(dir).status).toBe(0);
    });

    it("sets Model prices to null (self-hosted / no public API rate)", () => {
      const dir = writeFixture();

      const result = runManage(
        [
          "edit",
          "model",
          "model-a",
          "--json",
          '{"inputPricePer1M": null, "outputPricePer1M": null}',
        ],
        dir,
      );

      expect(result.status).toBe(0);
      const models = readDataFile<Array<{ inputPricePer1M: number | null }>>(dir, "models.json");
      expect(models[0]?.inputPricePer1M).toBeNull();
      expect(runValidate(dir).status).toBe(0);
    });

    it("adds and removes an optional Model field with a null patch value", () => {
      const dir = writeFixture();

      const added = runManage(
        ["edit", "model", "model-a", "--json", '{"licenseName": "Model A License"}'],
        dir,
      );
      expect(added.status).toBe(0);
      const withLicense = readDataFile<Array<Record<string, unknown>>>(dir, "models.json");
      expect(withLicense[0]?.licenseName).toBe("Model A License");

      const removed = runManage(["edit", "model", "model-a", "--json", '{"licenseName": null}'], dir);
      expect(removed.status).toBe(0);
      const withoutLicense = readDataFile<Array<Record<string, unknown>>>(dir, "models.json");
      expect(withoutLicense[0]).not.toHaveProperty("licenseName");
      expect(runValidate(dir).status).toBe(0);
    });

    it("refuses a Model edit that breaks the price invariant and writes nothing", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const result = runManage(
        ["edit", "model", "model-a", "--json", '{"outputPricePer1M": null}'],
        dir,
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("outputPricePer1M");
      expectUnchanged(dir, snapshot);
    });

    it("edits a Benchmark Tier and leaves the data directory valid", () => {
      const dir = writeFixture();

      const result = runManage(
        ["edit", "benchmark", "bench-1", "--json", '{"tier": "extended"}'],
        dir,
      );

      expect(result.status).toBe(0);
      const benchmarks = readDataFile<Array<{ tier: string }>>(dir, "benchmarks.json");
      expect(benchmarks[0]?.tier).toBe("extended");
      expect(runValidate(dir).status).toBe(0);
    });
  });

  describe("delete", () => {
    it("refuses to delete a Model that has Scores, unless --cascade is given", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const refused = runManage(["delete", "model", "model-a"], dir);

      expect(refused.status).toBe(1);
      expect(refused.output).toContain("refusing to delete");
      expect(refused.output).toContain("--cascade");
      expectUnchanged(dir, snapshot);

      const cascaded = runManage(["delete", "model", "model-a", "--cascade"], dir);

      expect(cascaded.status).toBe(0);
      expect(readDataFile<unknown[]>(dir, "models.json")).toHaveLength(0);
      expect(readDataFile<unknown[]>(dir, "scores.json")).toHaveLength(0);
      expect(runValidate(dir).status).toBe(0);
    });

    it("deletes a Model without Scores without needing --cascade", () => {
      const dir = writeFixture();
      runManage(["delete", "score", "model-a", "bench-1", "5-shot"], dir);

      const result = runManage(["delete", "model", "model-a"], dir);

      expect(result.status).toBe(0);
      expect(readDataFile<unknown[]>(dir, "models.json")).toHaveLength(0);
      expect(runValidate(dir).status).toBe(0);
    });

    it("refuses to delete a Benchmark that has Scores, unless --cascade is given", () => {
      const dir = writeFixture();
      const snapshot = snapshotFiles(dir);

      const refused = runManage(["delete", "benchmark", "bench-1"], dir);

      expect(refused.status).toBe(1);
      expect(refused.output).toContain("refusing to delete");
      expect(refused.output).toContain("--cascade");
      expectUnchanged(dir, snapshot);

      const cascaded = runManage(["delete", "benchmark", "bench-1", "--cascade"], dir);

      expect(cascaded.status).toBe(0);
      expect(readDataFile<unknown[]>(dir, "benchmarks.json")).toHaveLength(0);
      expect(readDataFile<unknown[]>(dir, "scores.json")).toHaveLength(0);
      expect(runValidate(dir).status).toBe(0);
    });

    it("deletes a Score and leaves the data directory valid", () => {
      const dir = writeFixture();

      const result = runManage(["delete", "score", "model-a", "bench-1", "5-shot"], dir);

      expect(result.status).toBe(0);
      expect(readDataFile<unknown[]>(dir, "scores.json")).toHaveLength(0);
      expect(runValidate(dir).status).toBe(0);
    });

    it("refuses to delete the only Primary score of a pair that keeps other Scores", () => {
      const dir = writeFixture({
        "evaluation-settings.json": [
          { name: "5-shot", description: "Five-shot prompting." },
          { name: "0-shot", description: "Zero-shot prompting." },
        ],
      });
      // Same-rank provider Score published before the fixture Primary
      // (2026-01-10), so the pair is a valid state before the delete.
      runManage(
        [
          "add",
          "score",
          "--json",
          JSON.stringify({
            modelId: "model-a",
            benchmarkId: "bench-1",
            value: 60,
            evaluationSetting: "0-shot",
            sourceType: "provider",
            sourceUrl: "https://example.com/model-a",
            publishedDate: "2026-01-05",
            retrievedDate: "2026-02-01",
            verified: true,
            isPrimary: false,
          }),
        ],
        dir,
      );
      const snapshot = snapshotFiles(dir);

      const result = runManage(["delete", "score", "model-a", "bench-1", "5-shot"], dir);

      expect(result.status).toBe(1);
      expect(result.output).toContain("no Primary score");
      expectUnchanged(dir, snapshot);
    });

    it("exits non-zero when the Model to delete does not exist", () => {
      const dir = writeFixture();

      const result = runManage(["delete", "model", "no-such-model"], dir);

      expect(result.status).toBe(1);
      expect(result.output).toContain("no-such-model");
    });
  });

  describe("data directory errors", () => {
    it("refuses to mutate when a data file is missing", () => {
      const dir = writeFixture();
      rmSync(path.join(dir, "scores.json"));

      const result = runManage(["delete", "model", "model-a"], dir);

      expect(result.status).toBe(1);
      expect(result.output).toContain("scores.json");
    });
  });
});
