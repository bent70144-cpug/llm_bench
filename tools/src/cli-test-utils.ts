import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared harness for the seam-2 CLI tests (spec "Testing Decisions"): every
 * tools command is spawned as a real process (node + tsx) against temporary
 * fixture data, and the contract under test is its exit code, its printed
 * messages, and the JSON it writes. Fixtures are synthetic and live only in
 * temp directories — the real data package never contains placeholder data.
 */

const require = createRequire(import.meta.url);
const tsxCli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");

export interface RunResult {
  status: number | null;
  output: string;
}

export function runTool(script: string, args: readonly string[]): RunResult {
  const scriptPath = fileURLToPath(new URL(`./${script}`, import.meta.url));
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...args], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

export function runValidate(dataDir: string): RunResult {
  return runTool("validate-data.ts", ["--data-dir", dataDir]);
}

export function runManage(args: readonly string[], dataDir?: string): RunResult {
  return runTool("manage-data.ts", dataDir === undefined ? args : ["--data-dir", dataDir, ...args]);
}

export function runImport(args: readonly string[], dataDir?: string): RunResult {
  return runTool("import-scores.ts", dataDir === undefined ? args : ["--data-dir", dataDir, ...args]);
}

export type DataFiles = {
  "models.json": unknown;
  "benchmarks.json": unknown;
  "scores.json": unknown;
  "evaluation-settings.json": unknown;
  "pricing-config.json": unknown;
};

export type DataFileName = keyof DataFiles;

export const DATA_FILE_NAMES: readonly DataFileName[] = [
  "models.json",
  "benchmarks.json",
  "scores.json",
  "evaluation-settings.json",
  "pricing-config.json",
];

export function validFixture(): DataFiles {
  return {
    "models.json": [
      {
        id: "model-a",
        name: "Model A",
        provider: "Provider A",
        license: "proprietary",
        releaseDate: "2026-01-05",
        contextWindow: 128000,
        inputPricePer1M: 1.5,
        outputPricePer1M: 3.0,
        referenceInferenceProvider: null,
        lastUpdated: "2026-02-01",
        sourceUrl: "https://example.com/model-a",
      },
    ],
    "benchmarks.json": [
      {
        id: "bench-1",
        name: "Bench 1",
        category: "reasoning",
        description: "A graduate-level reasoning Benchmark.",
        metric: "Accuracy (percent correct)",
        higherIsBetter: true,
        tier: "core",
        sourceUrl: "https://example.com/bench-1",
        canonicalSources: [{ sourceType: "provider" }, { sourceType: "paper" }],
        limitations: "Small evaluation set.",
        evaluationSettingNotes: "Providers self-report under varied settings.",
      },
    ],
    "scores.json": [
      {
        modelId: "model-a",
        benchmarkId: "bench-1",
        value: 75,
        evaluationSetting: "5-shot",
        sourceType: "provider",
        sourceUrl: "https://example.com/model-a",
        publishedDate: "2026-01-10",
        retrievedDate: "2026-02-01",
        verified: true,
        isPrimary: true,
      },
    ],
    "evaluation-settings.json": [{ name: "5-shot", description: "Five-shot prompting." }],
    "pricing-config.json": { inputWeight: 3, outputWeight: 1 },
  };
}

const tempDirs: string[] = [];

export function cleanupTempDirs(): void {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
}

export function writeFixture(overrides: Partial<DataFiles> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-bench-cli-"));
  tempDirs.push(dir);
  const fixture = { ...validFixture(), ...overrides };
  for (const [fileName, content] of Object.entries(fixture)) {
    writeFileSync(path.join(dir, fileName), `${JSON.stringify(content, null, 2)}\n`);
  }
  return dir;
}

export function readDataFile<T = unknown>(dataDir: string, fileName: DataFileName): T {
  return JSON.parse(readFileSync(path.join(dataDir, fileName), "utf8")) as T;
}

/** Raw file bytes, for asserting a command wrote nothing. */
export function readRawDataFile(dataDir: string, fileName: DataFileName): string {
  return readFileSync(path.join(dataDir, fileName), "utf8");
}

export function firstScore(fixture: DataFiles): Record<string, unknown> {
  const first = (fixture["scores.json"] as Array<Record<string, unknown>>)[0];
  if (!first) {
    throw new Error("fixture has no Score");
  }
  return first;
}

export function firstModel(fixture: DataFiles): Record<string, unknown> {
  const first = (fixture["models.json"] as Array<Record<string, unknown>>)[0];
  if (!first) {
    throw new Error("fixture has no Model");
  }
  return first;
}

export function firstBenchmark(fixture: DataFiles): Record<string, unknown> {
  const first = (fixture["benchmarks.json"] as Array<Record<string, unknown>>)[0];
  if (!first) {
    throw new Error("fixture has no Benchmark");
  }
  return first;
}
