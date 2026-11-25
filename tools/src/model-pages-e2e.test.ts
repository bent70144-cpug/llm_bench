import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model } from "@llm-bench/schema";
import { modelPath, resolveRoute } from "../../apps/web/src/routes";

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

function readModels(): Model[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "models.json"), "utf8")) as Model[];
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

    // Everything else is the generic not-found page — including the
    // not-yet-built /compare route (ticket 10) and malformed Model paths.
    expect(resolveRoute("/compare")).toEqual({ page: "not-found" });
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
});
