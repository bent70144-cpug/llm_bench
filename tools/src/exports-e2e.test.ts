import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import {
  buildFullDatasetExport,
  buildViewExport,
  defaultSelectedBenchmarkIds,
  rankModelsByAverage,
  viewExportToCsv,
  type LeaderboardUrlState,
} from "@llm-bench/scoring";

/**
 * Ticket 12 end-to-end proofs, in the established leaderboard-e2e style:
 * the real Published Results dataset must export exactly the agreed view and
 * dataset contracts, and the built bundle must ship the export controls'
 * wording. Expected values are hand-computed from packages/data (worked
 * examples from the raw JSON), so a change here is a deliberate data or
 * contract change, never a silent drift.
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

describe("exports over the real dataset", () => {
  const models = readJson<Model[]>("models.json");
  const benchmarks = readJson<Benchmark[]>("benchmarks.json");
  const scores = readJson<Score[]>("scores.json");
  const selection = defaultSelectedBenchmarkIds(benchmarks);

  // The default leaderboard view: the Tier-driven 12-core selection, ranked.
  const state: LeaderboardUrlState = {
    benchmarkIds: selection,
    weights: {},
    sort: { column: "average", direction: "desc" },
    search: "",
    licenses: [],
    providers: [],
    comparedModelIds: [],
  };
  const rows = rankModelsByAverage(models, { scores, benchmarkIds: selection });
  const view = buildViewExport({
    rows,
    benchmarks,
    scores,
    state,
    exportedAt: "2026-11-26T10:30:00.000Z",
  });
  const csv = viewExportToCsv(view);

  it("derives the CSV columns from the active selection — no hardcoded columns", () => {
    const header = csv.split("\r\n")[0]!;
    expect(
      header.startsWith(
        "Model id,Model name,Provider,License,License name,Context window," +
          "Release date,Input price / 1M,Output price / 1M,Reference inference provider," +
          "Average,Coverage,",
      ),
    ).toBe(true);

    // One value column plus four provenance companion columns per selected
    // Benchmark, in catalogue order — the extended-Tier Benchmarks are absent.
    const selectedNames = selection.map(
      (id) => benchmarks.find((benchmark) => benchmark.id === id)!.name,
    );
    const valueColumns = header
      .split(",")
      .slice(12)
      .filter((_, index) => index % 5 === 0);
    expect(valueColumns).toEqual(selectedNames);
    expect(header).not.toContain("ARC-AGI-2");
    expect(header).not.toContain("RULER");
  });

  it("exports real Model rows with Primary scores and their provenance", () => {
    const lines = csv.split("\r\n");

    // The rows keep the view's ranked order: GPT-6.2 Astra leads at 97 over
    // (1/12) — hand-checked from scores.json (its only core Primary is
    // GPQA Diamond 97).
    expect(lines[1]!.startsWith("gpt-6-2-astra,GPT-6.2 Astra,")).toBe(true);
    expect(lines[1]).toContain("(1/12)");

    // Claude Opus 4.6, hand-computed: Primary scores 91.31 (GPQA Diamond),
    // 99.79 (AIME 2025), 91.89 (tau²-bench Retail), 75.6 (SWE-bench
    // Verified, Source type leaderboard, source URL swebench.com) — Average
    // 358.59 / 4 = 89.6475 with Coverage (4/12). Its alternate Evaluation
    // settings (SWE-bench 80.84, tau²-bench Telecom 99.25) must NOT ship.
    const opus = lines.find((line) => line.startsWith("claude-opus-4-6,"))!;
    expect(opus).toContain("75.6,leaderboard,https://www.swebench.com/");
    expect(opus).toContain("89.6475,(4/12)");
    expect(opus).not.toContain("80.84");
    expect(opus).not.toContain("99.25");

    // Every Model in the view has a row: 26 data rows plus the header.
    expect(lines).toHaveLength(models.length + 2); // + header + trailing empty line
  });

  it("builds the view JSON with the self-describing metadata block", () => {
    expect(view.metadata).toMatchObject({
      kind: "llm-bench-view",
      formatVersion: 1,
      exportedAt: "2026-11-26T10:30:00.000Z",
      aggregate: "Average",
      rowCount: models.length,
    });
    expect(view.metadata.selectedBenchmarks.map((benchmark) => benchmark.id)).toEqual(selection);

    // Claude Opus 4.6's row: the Primary tau²-bench (Retail domain) score
    // with provenance, and null for the unmeasured MMLU-Pro.
    const opus = view.rows.find((row) => row.model.id === "claude-opus-4-6")!;
    expect(opus.average).toBe(89.6475);
    expect(opus.coverage).toEqual({ covered: 4, selected: 12 });
    expect(opus.scores["tau2-bench"]).toMatchObject({
      value: 91.89,
      evaluationSetting: "pass^1 (Retail domain)",
      sourceType: "provider",
      sourceUrl: "https://www.anthropic.com/claude-opus-4-6-system-card",
      publishedDate: "2026-02-05",
      retrievedDate: "2026-11-26",
      verified: true,
      isPrimary: true,
    });
    expect(opus.scores["mmlu-pro"]).toBeNull();
  });

  it("builds the full-dataset export with every Score, including the non-Primary alternate", () => {
    const dataset = buildFullDatasetExport({
      models,
      benchmarks,
      scores,
      exportedAt: "2026-11-26T10:30:00.000Z",
    });

    expect(dataset.kind).toBe("llm-bench-dataset");
    expect(dataset.models).toEqual(models);
    expect(dataset.benchmarks).toEqual(benchmarks);
    expect(dataset.scores).toHaveLength(scores.length);

    // Hand-checked from scores.json: the tau²-bench Telecom alternate for
    // Claude Opus 4.6 — a non-Primary Score that never feeds any Average.
    expect(dataset.scores).toContainEqual(
      expect.objectContaining({
        modelId: "claude-opus-4-6",
        benchmarkId: "tau2-bench",
        value: 99.25,
        evaluationSetting: "pass^1 (Telecom domain)",
        sourceType: "provider",
        isPrimary: false,
      }),
    );

    // The VIEW export never carries it — only the dataset export does.
    expect(JSON.stringify(view)).not.toContain("99.25");
  });

  it("ships the export controls and their labels in the built bundle", () => {
    const build = runBuild();
    expect(build.status).toBe(0);

    const bundle = readBuiltBundle();

    // The three controls' visible labels and their aria-labels — each states
    // what it exports.
    expect(bundle).toContain("Export view (CSV)");
    expect(bundle).toContain("Export view (JSON)");
    expect(bundle).toContain("Export full dataset (JSON)");
    expect(bundle).toContain("Export the current filtered and sorted view as CSV");
    expect(bundle).toContain("Export the current filtered and sorted view as JSON");
    expect(bundle).toContain(
      "Export the full raw dataset as JSON, including all Scores and alternate Evaluation settings",
    );
  }, 480_000);
});
