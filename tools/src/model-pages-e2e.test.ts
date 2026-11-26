import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model } from "@llm-bench/schema";
import { modelPath, resolveRoute } from "../../apps/web/src/routes";
import { startSpaStaticServer } from "./lib/spa-static-server";

/**
 * End-to-end proof (ticket 09): every Model in the data package has a
 * directly addressable detail page at /models/<id>, and the page content is
 * rendered from the data package — never hardcoded in the web app.
 *
 * Ticket 08's benchmark-pages-e2e.test.ts is the template; this file is the
 * Model-page equivalent:
 *
 * 1. Pure route resolution: the web app's route table resolves
 *    /models/<id> for every Model id in the data package, and every other
 *    path shape falls through to the generic not-found page.
 * 2. Built-bundle content: after `pnpm build`, the shipped bundle carries
 *    the route wiring, the Model-page furniture, and the real Model data
 *    the page renders from — null prices read exactly
 *    "self-hosted / no public API rate" and a Reference inference provider
 *    is named whenever a third party supplies the rate.
 * 3. Direct navigation: a static server with the same catch-all SPA rewrite
 *    as vercel.json serves the app shell for every Model route URL, so
 *    direct navigation and refresh reach the client-side router.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");
const DIST_ASSETS = path.join(DIST_DIR, "assets");

function readModels(): Model[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "models.json"), "utf8")) as Model[];
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

describe("Model detail pages (ticket 09)", () => {
  it("resolves every Model id from the data package to a route entry", () => {
    const models = readModels();
    expect(models).toHaveLength(26);

    // Every Model in the data package resolves to its own route entry —
    // adding a Model creates its page automatically.
    for (const model of models) {
      expect(resolveRoute(modelPath(model.id))).toEqual({
        page: "model",
        modelId: model.id,
      });
    }

    // Unknown ids still resolve to the Model page, which renders its own
    // not-found view (the page owns the data lookup).
    expect(resolveRoute("/models/not-in-the-data-package")).toEqual({
      page: "model",
      modelId: "not-in-the-data-package",
    });

    // A trailing slash is the same route; percent-escapes are decoded.
    expect(resolveRoute("/models/gpt-5-2/")).toEqual({ page: "model", modelId: "gpt-5-2" });
    expect(resolveRoute("/models/gpt-5-2%20")).toEqual({ page: "model", modelId: "gpt-5-2 " });

    // Everything else is the generic not-found page — malformed Model paths.
    // /compare is the compare view's route since ticket 10.
    expect(resolveRoute("/compare")).toEqual({ page: "compare" });
    expect(resolveRoute("/models")).toEqual({ page: "not-found" });
    expect(resolveRoute("/models/")).toEqual({ page: "not-found" });
    expect(resolveRoute("/models/gpt-5-2/extra")).toEqual({ page: "not-found" });
    expect(resolveRoute("/models/%")).toEqual({ page: "not-found" });
    expect(resolveRoute("/modelsology")).toEqual({ page: "not-found" });
    expect(resolveRoute("/anything-else")).toEqual({ page: "not-found" });

    // The existing routes are unchanged.
    expect(resolveRoute("/")).toEqual({ page: "leaderboard" });
    expect(resolveRoute("/benchmarks/mmlu-pro")).toEqual({
      page: "benchmark",
      benchmarkId: "mmlu-pro",
    });
  });

  it(
    "renders every Model detail page from the data package in the built bundle",
    () => {
      const models = readModels();
      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The route wiring ships: Model page paths are built from the
      // "/models/" prefix, and the page furniture (back link, the page's
      // own not-found view, the data-currency header) is wired in.
      expect(bundle).toContain("/models/");
      expect(bundle).toContain("Model not found");
      expect(bundle).toContain("Data current as of ");

      // The Model facts are labelled with the glossary vocabulary, null
      // prices read exactly "self-hosted / no public API rate", and a
      // Reference inference provider is named as the source of the rate.
      expect(bundle).toContain("Provider");
      expect(bundle).toContain("License name");
      expect(bundle).toContain("Context window");
      expect(bundle).toContain("Release date");
      expect(bundle).toContain("Input price / 1M");
      expect(bundle).toContain("Output price / 1M");
      expect(bundle).toContain("Reference inference provider");
      expect(bundle).toContain("rate from ");
      expect(bundle).toContain("self-hosted / no public API rate");

      // The page is 100% data-driven: every Model's name, notes, License
      // name, and source link ship via the data package. Links are built at
      // runtime as the "/models/" prefix plus the id, so each id in the
      // bundle is what makes the Model's page reachable.
      for (const model of models) {
        expect(bundle).toContain(jsonEscaped(model.name));
        expect(bundle).toContain(jsonEscaped(model.notes ?? ""));
        if (model.licenseName !== undefined) {
          expect(bundle).toContain(jsonEscaped(model.licenseName));
        }
        expect(bundle).toContain(model.sourceUrl);
        expect(bundle).toContain(jsonEscaped(model.id));
      }

      // A real null-priced Model (Llama 4 Maverick) and the real Models
      // whose rate comes from a third party (Kimi K2.5, MiniMax-M2.5) are
      // in the bundle the page renders from — the exact strings the page
      // shows for them are pinned interactively by the browser check.
      const nullPriced = models.filter((model) => model.inputPricePer1M === null);
      expect(nullPriced.map((model) => model.id)).toContain("llama-4-maverick");
      const thirdPartyRate = models.filter(
        (model) => model.referenceInferenceProvider !== null,
      );
      expect(thirdPartyRate.map((model) => model.id)).toEqual(
        expect.arrayContaining(["kimi-k2-5", "minimax-m2-5"]),
      );
      for (const model of thirdPartyRate) {
        expect(bundle).toContain(jsonEscaped(model.referenceInferenceProvider ?? ""));
      }
    },
    480_000,
  );

  it(
    "mounts the Score provenance view for every Benchmark on each Model page",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The per-Benchmark Scores area ships: one section per Benchmark (its
      // name links to the Benchmark's page), each mounting ticket 07's
      // ScorePairDetail — the Primary score and any alternate Evaluation
      // settings with full provenance, and an "n/a" sentence for pairs the
      // Model has not been scored on. ScorePairDetail's own labels ship
      // since ticket 07; what this pins is the Model page's wiring of it.
      expect(bundle).toContain("Every Score recorded for this Model");
      expect(bundle).toContain("Primary score");
      expect(bundle).toContain("no Scores have been published for");
    },
    480_000,
  );

  it(
    "ships the Model-versus-leaders chart, data-driven with n/a for gaps",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The chart section and its furniture ship: the section heading is
      // composed at runtime as "<Model name> against the Benchmark leaders",
      // the comparison series is the best Primary score across all Models
      // (from bestValueByBenchmark), and the note pins the n/a-never-zero
      // rule. The rows themselves (all 17 Benchmarks, in catalogue order)
      // are derived at runtime from the data package — pinned by the
      // browser check against the real values.
      expect(bundle).toContain("against the Benchmark leaders");
      expect(bundle).toContain("Best across Models");
      expect(bundle).toContain("Primary scores only");
      expect(bundle).toContain("never as zero");
    },
    480_000,
  );

  it(
    "serves direct navigation to every Model route through the SPA fallback",
    async () => {
      ensureBuilt();
      const indexHtml = readFileSync(path.join(DIST_DIR, "index.html"), "utf8");

      const server = await startSpaStaticServer(DIST_DIR);
      const base = `http://127.0.0.1:${server.port}`;
      try {
        // A direct navigation is a plain GET — exactly what a browser sends
        // for a shared link or a refresh. Every Model route (and the
        // unknown-id view, and a query string) must return the app shell,
        // which is what the vercel.json catch-all rewrite does in
        // production.
        for (const model of readModels()) {
          const response = await fetch(`${base}/models/${model.id}`);
          expect(response.status, model.id).toBe(200);
          expect(response.headers.get("content-type")).toContain("text/html");
          expect(await response.text()).toBe(indexHtml);
        }

        for (const pathname of [
          "/models/not-in-the-data-package", // client-side not-found view
          "/models/kimi-k2-5?selection=mmlu-pro", // query strings survive the rewrite
        ]) {
          const response = await fetch(`${base}${pathname}`);
          expect(response.status, pathname).toBe(200);
          expect(await response.text()).toBe(indexHtml);
        }
      } finally {
        await server.close();
      }
    },
    60_000,
  );
});
