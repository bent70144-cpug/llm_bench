import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import {
  computeAverage,
  defaultSelectedBenchmarkIds,
  formatCoverage,
  isUnderHalfCoverage,
  rankModelsByAverage,
} from "@llm-bench/scoring";

/**
 * Ticket 05 end-to-end proofs, in the established leaderboard-e2e style:
 * the real Published Results dataset must rank, badge, and display exactly
 * the agreed semantics, and the built bundle must ship the ranking UI's
 * wording. Expected values are hand-computed from packages/data (worked
 * examples from the raw JSON), so a change here is a deliberate data or
 * semantics change, never a silent drift.
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

describe("ranking and Coverage over the real dataset", () => {
  const models = readJson<Model[]>("models.json");
  const benchmarks = readJson<Benchmark[]>("benchmarks.json");
  const scores = readJson<Score[]>("scores.json");
  const selection = defaultSelectedBenchmarkIds(benchmarks);
  const context = { scores, benchmarkIds: selection };

  it("ranks all 29 Models by Average descending over the default 12 core Benchmarks", () => {
    // Hand-computed from models.json + scores.json: every Model's Primary
    // scores over the 12 core-Tier Benchmarks, averaged. All 29 Models have
    // at least one core Primary, so none has a null Average here.
    expect(rankModelsByAverage(models, context).map((model) => model.id)).toEqual([
      "gpt-6-2-astra", // 97 over 1
      "gpt-6-2-sol", // 96 over 1
      "kimi-k3-1-pro", // 94.2 over 1
      "kimi-k3", // 93.5 over 1
      "qwen3-8-2-4t-a95b", // 92.6 over 1
      "glm-5-2", // 91.2 over 1
      "deepseek-v4-1-flash", // 90.9 over 1
      "sakana-namazu", // 90.15 over 2
      "claude-opus-4-6", // 89.648 over 4
      "qwen3-7-max", // 89.52 over 5
      "claude-sonnet-4-6", // 89.2 over 4
      "deepseek-v4-pro", // 87.925 over 4
      "qwen3-6-plus", // 87.7 over 5
      "kimi-k2-5", // 86.52 over 5
      "glm-4-7", // 85.3 over 6 — exactly 50% Coverage
      "claude-opus-4-5", // 84.855 over 4
      "minimax-m2-5", // 83.9 over 3
      "qwen3-6-27b", // 83.775 over 4
      "kimi-k2-thinking", // 83.375 over 4
      "deepseek-v4-pro-base", // 83.18 over 5
      "qwen3-5-27b", // 83.117 over 6 — exactly 50% Coverage
      "gemini-3-pro", // 82.867 over 3
      "minimax-m2", // 77.933 over 6 — exactly 50% Coverage
      "mistral-medium-3-5", // 77.6 over 1
      "claude-sonnet-4-5", // 76.8 over 3
      "llama-4-maverick-base", // 74.2 over 2
      "claude-haiku-4-5", // 66.6 over 1
      "llama-4-maverick", // 64.567 over 3
      "gemini-2-5-pro", // 53.6 over 1
    ]);
  });

  it("badges exactly the Models under 50% Coverage — the three at exactly (6/12) are not badged", () => {
    // Hand-counted from scores.json: 26 of 29 Models are under 50% Coverage
    // on the default selection; GLM-4.7, Qwen3.5-27B, and MiniMax-M2 sit
    // exactly at (6/12) and must NOT carry the badge. (Compared as a set —
    // the badge has no order of its own.)
    const badged = models.filter((model) =>
      isUnderHalfCoverage(computeAverage(model.id, scores, { benchmarkIds: selection })),
    );
    expect(badged).toHaveLength(26);
    expect([...new Set(badged.map((model) => model.id))].sort()).toEqual(
      [
        "gpt-6-2-astra",
        "gpt-6-2-sol",
        "kimi-k3-1-pro",
        "kimi-k3",
        "qwen3-8-2-4t-a95b",
        "glm-5-2",
        "deepseek-v4-1-flash",
        "sakana-namazu",
        "claude-opus-4-6",
        "qwen3-7-max",
        "claude-sonnet-4-6",
        "deepseek-v4-pro",
        "qwen3-6-plus",
        "kimi-k2-5",
        "claude-opus-4-5",
        "minimax-m2-5",
        "qwen3-6-27b",
        "kimi-k2-thinking",
        "deepseek-v4-pro-base",
        "gemini-3-pro",
        "mistral-medium-3-5",
        "claude-sonnet-4-5",
        "llama-4-maverick-base",
        "claude-haiku-4-5",
        "llama-4-maverick",
        "gemini-2-5-pro",
      ].sort(),
    );

    // The boundary cases: exactly 50% Coverage is not "under 50%".
    for (const id of ["glm-4-7", "qwen3-5-27b", "minimax-m2"]) {
      const result = computeAverage(id, scores, { benchmarkIds: selection });
      expect(formatCoverage(result)).toBe("(6/12)");
      expect(isUnderHalfCoverage(result)).toBe(false);
    }

    // A sparse leader: Kimi K3.1 Pro tops the ranking at 94.2 but its
    // Coverage is (1/12), so it must be badged.
    const kimi = computeAverage("kimi-k3-1-pro", scores, { benchmarkIds: selection });
    expect(formatCoverage(kimi)).toBe("(1/12)");
    expect(isUnderHalfCoverage(kimi)).toBe(true);
  });

  it("sorts null-Average Models last, by name, when the selection leaves them unscored", () => {
    // Selection narrowed to GPQA Diamond: 22 Models have a Primary score
    // there; the 7 without drop to null Average and must sort below every
    // scored Model, alphabetically by Model name.
    const ranked = rankModelsByAverage(models, {
      scores,
      benchmarkIds: ["gpqa-diamond"],
    });
    const ids = ranked.map((model) => model.id);

    expect(ids.slice(-7)).toEqual([
      "claude-haiku-4-5", // "Claude Haiku 4.5"
      "deepseek-v4-pro-base", // "DeepSeek-V4-Pro-Base"
      "gemini-2-5-pro", // "Gemini 2.5 Pro"
      "kimi-k2-thinking", // "Kimi K2 Thinking"
      "llama-4-maverick-base", // "Llama 4 Maverick (base)"
      "mistral-medium-3-5", // "Mistral Medium 3.5"
      "sakana-namazu", // "Sakana Namazu"
    ]);
    // Every scored Model ranks above every null-Average Model.
    const nullAverageIds = new Set(ids.slice(-7));
    expect(ids.findIndex((id) => nullAverageIds.has(id))).toBe(ids.length - 7);
  });

  it("ships the ranking UI wording in the built bundle", () => {
    const build = runBuild();
    expect(build.status).toBe(0);

    const bundle = readBuiltBundle();

    // The badge label and its class ship — the badge is computed from the
    // Coverage fraction at render time, never a hardcoded Model list.
    expect(bundle).toContain("Under 50% Coverage");
    expect(bundle).toContain("coverage-badge");

    // The footer states how many Benchmarks the Average is computed over.
    expect(bundle).toContain("Average over");
    expect(bundle).toContain("selected Benchmark");
  }, 480_000);
});
