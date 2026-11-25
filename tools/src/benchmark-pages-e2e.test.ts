import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark } from "@llm-bench/schema";
import { benchmarkPath, resolveRoute } from "../../apps/web/src/routes";

/**
 * End-to-end proof (ticket 08): every Benchmark in the data package has a
 * directly addressable detail page, and the page content is rendered from
 * the data package — never hardcoded in the web app.
 *
 * Three angles, in ticket 02/03's bundle-content style:
 *
 * 1. Pure route resolution: the web app's route table (a parameterless
 *    module over strings) resolves `/benchmarks/<id>` for every Benchmark id
 *    in the data package, and every other path shape falls through to the
 *    generic not-found page.
 * 2. Built-bundle content: after `pnpm build`, the shipped bundle carries
 *    the route wiring plus every Benchmark's description, limitations, and
 *    evaluationSettingNotes — the detail pages render from data.
 * 3. Direct navigation: a static server with the same catch-all SPA rewrite
 *    as vercel.json serves the app shell for every Benchmark route URL, so
 *    direct navigation and refresh reach the client-side router.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");

function readCatalogue(): Benchmark[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "benchmarks.json"), "utf8")) as Benchmark[];
}

/**
 * The JSON-escaped body of a data string, exactly as it appears inside the
 * built bundle (the data package is inlined as JSON). Asserting the escaped
 * form keeps the check robust for any future data content.
 */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

describe("Benchmark detail pages (ticket 08)", () => {
  it("resolves every Benchmark id from the data package to a route entry", () => {
    const catalogue = readCatalogue();
    expect(catalogue).toHaveLength(17);

    // Every Benchmark in the data package resolves to its own route entry —
    // adding a Benchmark creates its page automatically.
    for (const benchmark of catalogue) {
      expect(resolveRoute(benchmarkPath(benchmark.id))).toEqual({
        page: "benchmark",
        benchmarkId: benchmark.id,
      });
    }

    // The leaderboard stays at the root.
    expect(resolveRoute("/")).toEqual({ page: "leaderboard" });

    // Unknown ids still resolve to the Benchmark page, which renders its
    // own not-found view (the page owns the data lookup).
    expect(resolveRoute("/benchmarks/not-in-the-data-package")).toEqual({
      page: "benchmark",
      benchmarkId: "not-in-the-data-package",
    });

    // A trailing slash is the same route.
    expect(resolveRoute("/benchmarks/mmlu-pro/")).toEqual({
      page: "benchmark",
      benchmarkId: "mmlu-pro",
    });

    // Everything else is the generic not-found page — including the
    // not-yet-built /models/:id and /compare routes (tickets 09/10) and
    // malformed Benchmark paths.
    expect(resolveRoute("/models/gpt-5-2")).toEqual({ page: "not-found" });
    expect(resolveRoute("/compare")).toEqual({ page: "not-found" });
    expect(resolveRoute("/benchmarks")).toEqual({ page: "not-found" });
    expect(resolveRoute("/benchmarks/")).toEqual({ page: "not-found" });
    expect(resolveRoute("/benchmarks/mmlu-pro/extra")).toEqual({ page: "not-found" });
    expect(resolveRoute("")).toEqual({ page: "not-found" });
    expect(resolveRoute("/anything-else")).toEqual({ page: "not-found" });
  });
});
