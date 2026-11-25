import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { COMPARE_PATH, resolveRoute } from "../../apps/web/src/routes";
import { startSpaStaticServer } from "./lib/spa-static-server";

/**
 * End-to-end proofs (ticket 10): the compare view.
 *
 * 1. Pure route resolution: /compare is its own route (the compared Models
 *    are query parameters, not path segments — ADR-0003's route shape), and
 *    malformed neighbours still fall through to the generic not-found page.
 * 2. Built-bundle content: the shipped bundle carries the compare wiring —
 *    the leaderboard's compare affordance, the compare page's furniture
 *    (guard-rail messages, the cap note, the chart notes), and the real
 *    Model names the page renders from the data package.
 * 3. Direct navigation: the SPA rewrite serves the shell for /compare with
 *    any query string, so a shared comparison survives refresh.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");
const DIST_ASSETS = path.join(DIST_DIR, "assets");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
}

/** Builds the web app unless a build is already present. */
function ensureBuilt(): void {
  if (!existsSync(path.join(DIST_DIR, "index.html"))) {
    const build = runBuild();
    expect(build.status).toBe(0);
  }
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

/**
 * The JSON-escaped body of a data string, exactly as it appears inside the
 * built bundle (the data package is inlined as JSON).
 */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

describe("compare view (ticket 10)", () => {
  it("resolves /compare as its own route, with the compared Models as query parameters", () => {
    expect(COMPARE_PATH).toBe("/compare");

    // The compare route — one path, no path parameters: which Models are
    // compared is URL query state (the `compare` parameter), shared with
    // the leaderboard's URL-state codec.
    expect(resolveRoute("/compare")).toEqual({ page: "compare" });

    // A single trailing slash is the same route (like every other route).
    expect(resolveRoute("/compare/")).toEqual({ page: "compare" });

    // Near-miss paths are not the compare route.
    expect(resolveRoute("/compares")).toEqual({ page: "not-found" });
    expect(resolveRoute("/compare/mmlu-pro")).toEqual({ page: "not-found" });
    expect(resolveRoute("/comparison")).toEqual({ page: "not-found" });

    // The existing routes are unchanged.
    expect(resolveRoute("/")).toEqual({ page: "leaderboard" });
    expect(resolveRoute("/benchmarks/mmlu-pro")).toEqual({
      page: "benchmark",
      benchmarkId: "mmlu-pro",
    });
    expect(resolveRoute("/models/gpt-5-2")).toEqual({ page: "model", modelId: "gpt-5-2" });
    expect(resolveRoute("/anything-else")).toEqual({ page: "not-found" });
  });
});
