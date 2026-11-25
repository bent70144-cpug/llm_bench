import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import {
  decodeLeaderboardUrlState,
  DEFAULT_LEADERBOARD_SORT,
  encodeLeaderboardUrlState,
  filterModels,
  rankModelsByAverage,
  sortModelsByColumn,
} from "@llm-bench/scoring";

/**
 * Ticket 06 end-to-end proofs, in the established leaderboard-e2e style:
 * the built bundle must ship the weights UI's wording and the URL-state
 * parameter names (the public contract of shared URLs), and the shareable
 * URL codec must restore a real weighted view over the real Published
 * Results dataset exactly. Expected values are computed from packages/data
 * via the scoring package, so a change here is a deliberate data or
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

describe("shareable URL state over the real dataset", () => {
  const models = readJson<Model[]>("models.json");
  const benchmarks = readJson<Benchmark[]>("benchmarks.json");
  const scores = readJson<Score[]>("scores.json");

  it("decodes a shared URL into the exact weighted view and reproduces its ranking", () => {
    // A URL a visitor could have shared after weighting SWE-bench Verified ×2
    // over a two-Benchmark selection, sorted by GPQA Diamond, searching for
    // Claude Models under the proprietary License.
    const shared =
      "benchmarks=mmlu-pro,gpqa-diamond&weights=swebench-verified:2,mmlu-pro:0.5" +
      "&sort=gpqa-diamond:desc&q=Claude&license=proprietary&compare=claude-opus-4-6";

    const state = decodeLeaderboardUrlState(shared, benchmarks);

    // The selection and every filter restored exactly; the weight on the
    // unselected swebench-verified is remembered; the compared Model id is
    // carried verbatim (reserved for the compare view).
    expect(state.benchmarkIds).toEqual(["mmlu-pro", "gpqa-diamond"]);
    expect(state.weights).toEqual({ "swebench-verified": 2, "mmlu-pro": 0.5 });
    expect(state.sort).toEqual({ column: "gpqa-diamond", direction: "desc" });
    expect(state.search).toBe("Claude");
    expect(state.licenses).toEqual(["proprietary"]);
    expect(state.comparedModelIds).toEqual(["claude-opus-4-6"]);

    // The leaderboard pipeline over the decoded state: the same computation
    // the UI runs, over the real Published Results. Hand-computed from the
    // data package: the five proprietary Claude Models, none with an
    // mmlu-pro Primary score, so each Weighted Average is its gpqa-diamond
    // score (a Model missing a Benchmark is not penalized) — sorted by
    // gpqa-diamond descending with the null-aggregate Model last.
    const shortlist = filterModels(models, {
      search: state.search,
      licenses: state.licenses,
    });
    expect(shortlist.map((model) => model.id).sort()).toEqual(
      [
        "claude-opus-4-5",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4-6",
        "claude-sonnet-4-6",
      ].sort(),
    );

    const view = sortModelsByColumn(
      shortlist,
      state.sort,
      { scores, benchmarkIds: state.benchmarkIds, weights: state.weights },
    );
    expect(view.map((model) => model.id)).toEqual([
      "claude-opus-4-6", // gpqa-diamond 91.31
      "claude-sonnet-4-6", // 89.9
      "claude-opus-4-5", // 86.95
      "claude-sonnet-4-5", // 83.4
      "claude-haiku-4-5", // no Primary score on the selection — last, never zero
    ]);

    // Ranked by the active aggregate (mmlu-pro's 0.5 weight is active on
    // the selection, so the label reads Weighted Average): the same order
    // as the gpqa-diamond sort here, because every covered Benchmark set is
    // a single Benchmark.
    const ranked = rankModelsByAverage(shortlist, {
      scores,
      benchmarkIds: state.benchmarkIds,
      weights: state.weights,
    });
    expect(ranked.map((model) => model.id)).toEqual(view.map((model) => model.id));

    // Re-encoding the decoded state is stable: the canonical URL for this
    // view round-trips (weights sorted by id, defaults omitted).
    const reEncoded = encodeLeaderboardUrlState(state);
    expect(reEncoded).toBe(
      "benchmarks=mmlu-pro,gpqa-diamond&weights=mmlu-pro:0.5,swebench-verified:2" +
        "&sort=gpqa-diamond:desc&q=Claude&license=proprietary&compare=claude-opus-4-6",
    );
    expect(decodeLeaderboardUrlState(reEncoded, benchmarks)).toEqual(state);
  });

  it("keeps the Tier-driven default selection when the URL carries no state", () => {
    const pristine = decodeLeaderboardUrlState("", benchmarks);
    expect(pristine.benchmarkIds.filter((id) => id === "hellaswag")).toEqual(["hellaswag"]);
    expect(pristine.sort).toEqual(DEFAULT_LEADERBOARD_SORT);
    expect(pristine.weights).toEqual({});
    // The core default re-encodes to the plain selection-only URL.
    expect(encodeLeaderboardUrlState(pristine)).toBe(
      "benchmarks=mmlu-pro,mmlu,gpqa-diamond,bbh,math-500,aime-2025,humaneval,livecodebench," +
        "swebench-verified,tau2-bench,ifeval,hellaswag",
    );
  });
});

describe("the built bundle ships the weights UI and the URL parameter contract", () => {
  it("contains the Weighted Average label, the weights controls, and the query parameter names", () => {
    const build = runBuild();
    expect(build.status).toBe(0);

    const bundle = readBuiltBundle();

    // The aggregate label and its footer phrasing (both states ship — the
    // label switches at render time, never a hardcoded list).
    expect(bundle).toContain("Weighted Average");
    expect(bundle).toContain("Weighted Average over");
    expect(bundle).toContain("Average over");
    expect(bundle).toContain("selected Benchmark");

    // The weights controls: the fieldset legend, the per-Benchmark label
    // template, and the documented weight-0 semantics.
    expect(bundle).toContain("Benchmark weights");
    expect(bundle).toContain("Weight — ");
    expect(bundle).toContain("excludes a Benchmark from the Weighted Average");
    expect(bundle).toContain("No Benchmarks selected.");

    // The URL-state parameter names — the public contract of shared URLs;
    // renaming one silently breaks every shared link, so it is pinned here.
    // (esbuild minifies these string literals with backticks, so accept any
    // of the three quote characters around the name.)
    for (const parameter of [
      "benchmarks",
      "weights",
      "sort",
      "q",
      "license",
      "provider",
      "min-context",
      "max-input-price",
      "max-output-price",
      "compare",
    ]) {
      expect(bundle).toMatch(new RegExp(`["'\\\`]${parameter}["'\\\`]`));
    }
  }, 480_000);
});
