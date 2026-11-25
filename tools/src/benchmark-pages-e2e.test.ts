import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark } from "@llm-bench/schema";
import { benchmarkPath, resolveRoute } from "../../apps/web/src/routes";
import { startSpaStaticServer } from "./lib/spa-static-server";

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
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");
const DIST_ASSETS = path.join(DIST_DIR, "assets");

function readCatalogue(): Benchmark[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "benchmarks.json"), "utf8")) as Benchmark[];
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

  it(
    "renders every Benchmark detail page from the data package in the built bundle",
    () => {
      const catalogue = readCatalogue();
      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The route wiring ships: Benchmark page paths are built from the
      // "/benchmarks/" prefix, and the page furniture (back link, the two
      // not-found variants, the provenance section) is wired in.
      expect(bundle).toContain("/benchmarks/");
      expect(bundle).toContain("Back to leaderboard");
      expect(bundle).toContain("Benchmark not found");
      expect(bundle).toContain("Page not found");
      expect(bundle).toContain("Canonical sources");

      // The detail page content is 100% data-driven: every Benchmark's
      // description, limitations (saturation and contamination notes),
      // evaluationSettingNotes, and source link ship via the data package —
      // nothing per-Benchmark is hardcoded in the web app. Links are built
      // at runtime as the "/benchmarks/" prefix plus the id, so each id in
      // the bundle is what makes the Benchmark's page reachable.
      for (const benchmark of catalogue) {
        expect(bundle).toContain(jsonEscaped(benchmark.description));
        expect(bundle).toContain(jsonEscaped(benchmark.limitations));
        expect(bundle).toContain(jsonEscaped(benchmark.evaluationSettingNotes));
        expect(bundle).toContain(benchmark.sourceUrl);
        expect(bundle).toContain(jsonEscaped(benchmark.id));
      }
    },
    480_000,
  );

  it("keeps the catch-all SPA rewrite that serves direct links in production", () => {
    // ADR-0003: static hosting relies on vercel.json rewriting every path
    // that matches no file to index.html, so direct navigation and refresh
    // on /benchmarks/<id> reach the client-side router. Ticket 01 laid this
    // down; ticket 08 relies on it, so pin it.
    const vercel = JSON.parse(readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8")) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    expect(vercel.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });

  it(
    "serves direct navigation to every Benchmark route through the SPA fallback",
    async () => {
      ensureBuilt();
      const indexHtml = readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
      const assetFile = readdirSync(DIST_ASSETS)[0];
      if (assetFile === undefined) {
        throw new Error("no built assets found in apps/web/dist/assets");
      }

      const server = await startSpaStaticServer(DIST_DIR);
      const base = `http://127.0.0.1:${server.port}`;
      try {
        // A direct navigation is a plain GET — exactly what a browser sends
        // for a shared link or a refresh. Every Benchmark route (and every
        // not-yet-built route) must return the app shell, which is what the
        // vercel.json catch-all rewrite does in production.
        for (const benchmark of readCatalogue()) {
          const response = await fetch(`${base}/benchmarks/${benchmark.id}`);
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toContain("text/html");
          expect(await response.text()).toBe(indexHtml);
        }

        for (const pathname of [
          "/",
          "/benchmarks/not-in-the-data-package", // client-side not-found view
          "/benchmarks/gpqa-diamond?selection=gpqa-diamond", // query strings survive the rewrite
          "/models/gpt-5-2", // ticket 09; generic not-found for now
          "/compare", // ticket 10; generic not-found for now
        ]) {
          const response = await fetch(`${base}${pathname}`);
          expect(response.status, pathname).toBe(200);
          expect(await response.text()).toBe(indexHtml);
        }

        // Real files are served as themselves, not rewritten to the shell.
        const assetResponse = await fetch(`${base}/assets/${assetFile}`);
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get("content-type")).toContain(
          assetFile.endsWith(".js") ? "javascript" : "text/css",
        );
        expect(await assetResponse.text()).toBe(
          readFileSync(path.join(DIST_ASSETS, assetFile), "utf8"),
        );
      } finally {
        await server.close();
      }
    },
    60_000,
  );
});
