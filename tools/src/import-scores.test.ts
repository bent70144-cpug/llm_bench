import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupTempDirs,
  readDataFile,
  readRawDataFile,
  runImport,
  runValidate,
  writeFixture,
} from "./cli-test-utils";

/**
 * Seam 2: the import-scores CSV CLI is invoked as a process against
 * temporary fixture data. The contract under test: exit codes, messages,
 * and the JSON it writes — every row is validated before anything is
 * written (all-or-nothing).
 */

afterAll(cleanupTempDirs);

const CSV_HEADER =
  "modelId,benchmarkId,value,evaluationSetting,sourceType,sourceUrl,publishedDate,retrievedDate,verified,isPrimary";

const TWO_SETTING_VOCABULARY = [
  { name: "5-shot", description: "Five-shot prompting." },
  { name: "0-shot", description: "Zero-shot prompting." },
  { name: "1-shot", description: "One-shot prompting." },
];

function writeCsv(dir: string, fileName: string, lines: readonly string[]): string {
  const csvPath = path.join(dir, fileName);
  writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");
  return csvPath;
}

function snapshotScores(dir: string): string {
  return readRawDataFile(dir, "scores.json");
}

describe("import-scores CLI", () => {
  it("prints documented usage with --help and exits 0", () => {
    const result = runImport(["--help"]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("modelId");
    expect(result.output).toContain("evaluationSetting");
    expect(result.output).toContain("--data-dir");
  });

  it("imports every valid row and leaves the data directory valid", () => {
    const dir = writeFixture({ "evaluation-settings.json": TWO_SETTING_VOCABULARY });
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "model-a,bench-1,60,0-shot,provider,https://example.com/model-a,2026-01-11,2026-02-01,true,false",
      "model-a,bench-1,65,1-shot,provider,https://example.com/model-a,2026-01-12,2026-02-01,true,false",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(0);
    expect(result.output).toContain("2 Score(s)");
    const scores = readDataFile<Array<{ evaluationSetting: string; value: number }>>(
      dir,
      "scores.json",
    );
    expect(scores).toHaveLength(3);
    expect(scores.map((score) => score.evaluationSetting).sort()).toEqual([
      "0-shot",
      "1-shot",
      "5-shot",
    ]);
    expect(runValidate(dir).status).toBe(0);
  });

  it("replaces an existing (Model, Benchmark, Evaluation setting) triple in place", () => {
    const dir = writeFixture();
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "model-a,bench-1,77,5-shot,provider,https://example.com/model-a,2026-01-10,2026-02-01,true,true",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(0);
    expect(result.output).toContain("updated");
    const scores = readDataFile<Array<{ value: number }>>(dir, "scores.json");
    expect(scores).toHaveLength(1);
    expect(scores[0]?.value).toBe(77);
    expect(runValidate(dir).status).toBe(0);
  });

  it("writes nothing and exits non-zero when one row is malformed", () => {
    const dir = writeFixture({ "evaluation-settings.json": TWO_SETTING_VOCABULARY });
    const before = snapshotScores(dir);
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "model-a,bench-1,60,0-shot,provider,https://example.com/model-a,2026-01-11,2026-02-01,true,false",
      "model-a,bench-1,not-a-number,1-shot,provider,https://example.com/model-a,2026-01-12,2026-02-01,true,false",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("row 3");
    expect(result.output).toContain("not-a-number");
    expect(readRawDataFile(dir, "scores.json")).toBe(before);
  });

  it("writes nothing and exits non-zero when a row references an unknown Model", () => {
    const dir = writeFixture();
    const before = snapshotScores(dir);
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "no-such-model,bench-1,60,5-shot,provider,https://example.com/no-such-model,2026-01-11,2026-02-01,true,false",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("no-such-model");
    expect(readRawDataFile(dir, "scores.json")).toBe(before);
  });

  it("writes nothing and exits non-zero when rows would break the exactly-one-Primary rule", () => {
    const dir = writeFixture({ "evaluation-settings.json": TWO_SETTING_VOCABULARY });
    const before = snapshotScores(dir);
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "model-a,bench-1,60,0-shot,provider,https://example.com/model-a,2026-01-11,2026-02-01,true,true",
      "model-a,bench-1,65,1-shot,provider,https://example.com/model-a,2026-01-12,2026-02-01,true,true",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Primary");
    expect(readRawDataFile(dir, "scores.json")).toBe(before);
  });

  it("exits non-zero when the header row is missing a required column", () => {
    const dir = writeFixture();
    const csv = writeCsv(dir, "scores.csv", [
      "modelId,benchmarkId,evaluationSetting,sourceType,sourceUrl,publishedDate,retrievedDate,verified,isPrimary",
      "model-a,bench-1,5-shot,provider,https://example.com/model-a,2026-01-10,2026-02-01,true,true",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("value");
  });

  it("exits non-zero when a row has the wrong number of fields", () => {
    const dir = writeFixture();
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      "model-a,bench-1,60,5-shot,provider,https://example.com/model-a,2026-01-11,2026-02-01,true",
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(1);
    expect(result.output).toContain("row 2");
  });

  it("parses quoted CSV fields containing commas", () => {
    const dir = writeFixture({
      "evaluation-settings.json": [
        ...TWO_SETTING_VOCABULARY,
        { name: "CoT, 5-shot", description: "Chain-of-thought with five shots." },
      ],
    });
    const csv = writeCsv(dir, "scores.csv", [
      CSV_HEADER,
      'model-a,bench-1,55,"CoT, 5-shot",provider,https://example.com/model-a,2026-01-13,2026-02-01,true,false',
    ]);

    const result = runImport([csv], dir);

    expect(result.status).toBe(0);
    const scores = readDataFile<Array<{ evaluationSetting: string }>>(dir, "scores.json");
    expect(scores.map((score) => score.evaluationSetting)).toContain("CoT, 5-shot");
    expect(runValidate(dir).status).toBe(0);
  });

  it("exits 2 with usage when no CSV file is given", () => {
    const dir = writeFixture();

    const result = runImport([], dir);

    expect(result.status).toBe(2);
    expect(result.output).toContain("usage");
  });
});
