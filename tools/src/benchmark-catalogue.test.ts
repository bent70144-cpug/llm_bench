import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, EvaluationSetting, Score } from "@llm-bench/schema";

/**
 * The Benchmark catalogue contract (ticket 03): the researched 17-Benchmark
 * catalogue (12 core + 5 extended, nine categories) transcribed from the
 * orchestration notes into packages/data/benchmarks.json, plus the
 * Evaluation settings vocabulary the notes propose (extended with the
 * setting the existing Scores actually use).
 *
 * These are catalogue facts `pnpm validate` cannot check (it verifies
 * structure, not composition), so they are pinned here against the
 * researched source. Structural rules live in validate-data.test.ts.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");

function readDataFile<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, fileName), "utf8")) as T;
}

/** The 12 core Benchmarks of the researched catalogue. */
const CORE_BENCHMARKS: readonly { id: string; name: string }[] = [
  { id: "mmlu-pro", name: "MMLU-Pro" },
  { id: "mmlu", name: "MMLU" },
  { id: "gpqa-diamond", name: "GPQA Diamond" },
  { id: "bbh", name: "BIG-Bench Hard (BBH)" },
  { id: "math-500", name: "MATH-500" },
  { id: "aime-2025", name: "AIME 2025" },
  { id: "humaneval", name: "HumanEval" },
  { id: "livecodebench", name: "LiveCodeBench" },
  { id: "swebench-verified", name: "SWE-bench Verified" },
  { id: "tau2-bench", name: "τ²-bench (tau2-bench)" },
  { id: "ifeval", name: "IFEval" },
  { id: "hellaswag", name: "HellaSwag" },
];

/** The 5 extended Benchmarks of the researched catalogue. */
const EXTENDED_BENCHMARKS: readonly { id: string; name: string }[] = [
  { id: "arc-agi-2", name: "ARC-AGI-2" },
  { id: "ruler", name: "RULER" },
  { id: "truthfulqa", name: "TruthfulQA" },
  { id: "mbpp", name: "MBPP" },
  { id: "winogrande", name: "WinoGrande" },
];

/** The nine agreed Benchmark categories. */
const NINE_CATEGORIES = [
  "knowledge",
  "reasoning",
  "math",
  "coding",
  "instruction-following",
  "agentic",
  "long-context",
  "commonsense",
  "robustness",
] as const;

/** The proposed vocabulary plus the setting the existing Score uses. */
const EVALUATION_SETTING_NAMES = [
  "Max reasoning effort (temperature 1.0, top-p 0.95)",
  "0-shot",
  "0-shot CoT",
  "3-shot",
  "3-shot CoT",
  "4-shot",
  "4-shot CoT",
  "5-shot",
  "5-shot CoT",
  "10-shot",
  "pass@1",
  "pass^1",
  "with thinking",
  "no thinking",
  "128k context",
] as const;

const expectedCatalogue = [...CORE_BENCHMARKS, ...EXTENDED_BENCHMARKS];

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("the researched Benchmark catalogue in packages/data", () => {
  const benchmarks = readDataFile<Benchmark[]>("benchmarks.json");

  it("contains exactly the 17 researched Benchmarks with their names", () => {
    expect(benchmarks).toHaveLength(17);
    expect(sorted(benchmarks.map((benchmark) => benchmark.id))).toEqual(
      sorted(expectedCatalogue.map((benchmark) => benchmark.id)),
    );
    expect(sorted(benchmarks.map((benchmark) => benchmark.name))).toEqual(
      sorted(expectedCatalogue.map((benchmark) => benchmark.name)),
    );
  });

  it("marks exactly the 12 core and 5 extended Benchmarks by Tier", () => {
    expect(sorted(benchmarks.filter((b) => b.tier === "core").map((b) => b.id))).toEqual(
      sorted(CORE_BENCHMARKS.map((benchmark) => benchmark.id)),
    );
    expect(sorted(benchmarks.filter((b) => b.tier === "extended").map((b) => b.id))).toEqual(
      sorted(EXTENDED_BENCHMARKS.map((benchmark) => benchmark.id)),
    );
  });

  it("covers all nine category values of the agreed enum", () => {
    const usedCategories = [...new Set(benchmarks.map((benchmark) => benchmark.category))];
    expect(sorted(usedCategories)).toEqual(sorted(NINE_CATEGORIES));
  });
});

describe("the Evaluation settings vocabulary in packages/data", () => {
  it("contains the researched vocabulary plus every setting used by a Score", () => {
    const vocabulary = readDataFile<EvaluationSetting[]>("evaluation-settings.json").map(
      (setting) => setting.name,
    );
    const usedByScores = readDataFile<Score[]>("scores.json").map(
      (score) => score.evaluationSetting,
    );

    for (const name of EVALUATION_SETTING_NAMES) {
      expect(vocabulary).toContain(name);
    }
    for (const setting of usedByScores) {
      expect(vocabulary).toContain(setting);
    }
  });
});
