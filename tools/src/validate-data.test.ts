import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupTempDirs,
  firstBenchmark,
  firstModel,
  firstScore,
  runValidate,
  validFixture,
  writeFixture,
} from "./cli-test-utils";

/**
 * Seam 2: the validate-data CLI is invoked as a process against temporary
 * fixture data; the contract is its exit code and printed messages.
 * Fixtures are synthetic and live only in these tests — the real data
 * package never contains placeholder data.
 */

afterAll(cleanupTempDirs);

describe("validate-data CLI", () => {
  it("exits 0 on valid data", () => {
    const result = runValidate(writeFixture());

    expect(result.status).toBe(0);
  });

  it("exits non-zero when a Score references an unknown Model", () => {
    const fixture = validFixture();
    firstScore(fixture).modelId = "no-such-model";

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("no-such-model");
  });

  it("exits non-zero when a Score references an unknown Benchmark", () => {
    const fixture = validFixture();
    firstScore(fixture).benchmarkId = "no-such-benchmark";

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("no-such-benchmark");
  });

  it("exits non-zero when a Score value is outside 0-100", () => {
    const fixture = validFixture();
    firstScore(fixture).value = 150;

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("value");
  });

  it("exits non-zero when publishedDate is after retrievedDate", () => {
    const fixture = validFixture();
    firstScore(fixture).publishedDate = "2026-03-01";

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("publishedDate");
  });

  it("exits non-zero when a Model has one price but not the other", () => {
    const fixture = validFixture();
    firstModel(fixture).outputPricePer1M = null;

    const result = runValidate(writeFixture({ "models.json": fixture["models.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("outputPricePer1M");
  });

  it("exits non-zero when a null-priced Model names a Reference inference provider", () => {
    const fixture = validFixture();
    const model = firstModel(fixture);
    model.inputPricePer1M = null;
    model.outputPricePer1M = null;
    model.referenceInferenceProvider = "Some Host";

    const result = runValidate(writeFixture({ "models.json": fixture["models.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("referenceInferenceProvider");
  });

  it("exits non-zero on a schema violation such as an invalid License", () => {
    const fixture = validFixture();
    firstModel(fixture).license = "source-available";

    const result = runValidate(writeFixture({ "models.json": fixture["models.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("license");
  });

  it("exits non-zero when an Evaluation setting is not in the vocabulary", () => {
    const fixture = validFixture();
    firstScore(fixture).evaluationSetting = "42-shot";

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("42-shot");
  });

  it("exits non-zero when a Benchmark is not higherIsBetter (v1 rule)", () => {
    const fixture = validFixture();
    firstBenchmark(fixture).higherIsBetter = false;

    const result = runValidate(writeFixture({ "benchmarks.json": fixture["benchmarks.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("higherIsBetter");
  });

  it("exits non-zero on duplicate Model ids", () => {
    const fixture = validFixture();
    const models = fixture["models.json"] as Array<Record<string, unknown>>;
    models.push({ ...models[0] });

    const result = runValidate(writeFixture({ "models.json": models }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("duplicate Model id");
  });

  it("exits non-zero when a data file is missing", () => {
    const dir = writeFixture();
    rmSync(path.join(dir, "scores.json"));

    const result = runValidate(dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("scores.json");
  });

  it("exits non-zero when a Model and Benchmark pair has more than one Primary score", () => {
    const fixture = validFixture();
    const scores = fixture["scores.json"] as Array<Record<string, unknown>>;
    scores.push({
      ...firstScore(fixture),
      evaluationSetting: "0-shot",
      value: 60,
      isPrimary: true,
    });
    fixture["evaluation-settings.json"] = [
      { name: "5-shot", description: "Five-shot prompting." },
      { name: "0-shot", description: "Zero-shot prompting." },
    ];

    const result = runValidate(writeFixture(fixture));

    expect(result.status).toBe(1);
    expect(result.output).toContain("Primary");
  });

  it("exits non-zero when a Model and Benchmark pair has Scores but no Primary score", () => {
    const fixture = validFixture();
    firstScore(fixture).isPrimary = false;

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("Primary");
  });

  it("exits non-zero on a duplicate (Model, Benchmark, Evaluation setting) triple", () => {
    const fixture = validFixture();
    const scores = fixture["scores.json"] as Array<Record<string, unknown>>;
    scores.push({ ...firstScore(fixture), value: 80 });

    const result = runValidate(writeFixture({ "scores.json": scores }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("duplicate");
  });

  it("exits non-zero when a Primary score's Source type is not in the Benchmark's Canonical sources", () => {
    const fixture = validFixture();
    firstScore(fixture).sourceType = "third-party";

    const result = runValidate(writeFixture({ "scores.json": fixture["scores.json"] }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("Canonical sources");
  });
});
