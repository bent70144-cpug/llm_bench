import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ticket 14 — the repository's deployment and CI contract, pinned so drift
 * is caught by `pnpm test` before it reaches Vercel or GitHub Actions.
 *
 * 1. vercel.json must keep the PRD §8A static-deployment settings: install
 *    with a frozen lockfile, build the web app, serve apps/web/dist, and
 *    rewrite every path to the SPA shell (ADR-0003) so direct links and
 *    refreshes on Model, Benchmark and compare routes work. It must stay
 *    static-only: no serverless functions, no database, no paid add-ons
 *    (ADR-0004 — Vercel Hobby, strictly non-commercial).
 * 2. .github/workflows/ci.yml must run the four gates and the browser
 *    suite on every pull request with the pinned toolchain.
 * 3. Every workspace package must carry a lint script that applies the
 *    shared ESLint flat config from @llm-bench/config.
 * 4. README.md must record the non-commercial hosting constraint and point
 *    at the glossary and ADRs.
 *
 * These are file-contract pins in the established style (see the vercel
 * rewrite pin from ticket 08): they assert observable repository state, not
 * implementation details.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface VercelRewrite {
  source: string;
  destination: string;
}

type VercelConfig = Record<string, unknown> & { rewrites?: VercelRewrite[] };

function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8")) as VercelConfig;
}

/** The first real ids from the data package — the routes users actually hit. */
function sampleRoutePaths(): string[] {
  const benchmarks = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/data/benchmarks.json"), "utf8")) as Array<{ id: string }>;
  const models = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/data/models.json"), "utf8")) as Array<{ id: string }>;
  return [
    "/",
    `/benchmarks/${benchmarks[0]!.id}`,
    `/models/${models[0]!.id}`,
    "/compare",
    "/not-a-known-route",
  ];
}

describe("static deployment contract (ticket 14)", () => {
  it("deploys static output from the repository root with the pinned install, build and output settings", () => {
    // PRD §8A: deployed from the repository root via vercel.json, with the
    // same frozen lockfile and build command CI and local development use.
    const vercel = readVercelConfig();
    expect(vercel["installCommand"]).toBe("pnpm install --frozen-lockfile");
    expect(vercel["buildCommand"]).toBe("pnpm --filter web build");
    expect(vercel["outputDirectory"]).toBe("apps/web/dist");
  });

  it("rewrites every route to the SPA shell so Model, Benchmark and compare deep links survive refresh", () => {
    // ADR-0003: the client-side router needs every non-file path to serve
    // index.html. Ticket 08 pinned the rewrite object itself; ticket 14
    // additionally proves the pattern actually catches every route shape.
    const vercel = readVercelConfig();
    expect(vercel.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });

    const catchAll = vercel.rewrites?.find((rewrite) => rewrite.destination === "/index.html");
    expect(catchAll).toBeDefined();
    // Vercel matches rewrites against the request path with path-to-regexp
    // syntax; stripping the leading "/" leaves the embedded regex. If it
    // ever stops matching a route shape, that route 404s in production.
    const routePattern = new RegExp(`^(?:${catchAll!.source.replace(/^\//, "")})$`);
    for (const route of sampleRoutePaths()) {
      expect(routePattern.test(route), `rewrite must catch ${route}`).toBe(true);
    }
  });

  it("configures static hosting only — no serverless functions, database, cron, or paid add-ons", () => {
    // ADR-0004: Vercel Hobby serves static output; functions, cron jobs and
    // add-ons are either paid or a step towards a backend the spec keeps
    // out of scope. Vercel also turns an api/ directory into serverless
    // functions WITHOUT any config, so the directories are checked too.
    const vercel = readVercelConfig();
    const staticOnlyKeys = ["installCommand", "buildCommand", "outputDirectory", "rewrites", "cleanUrls", "trailingSlash", "headers"];
    const unexpected = Object.keys(vercel).filter((key) => !staticOnlyKeys.includes(key));
    expect(unexpected, `non-static vercel.json keys: ${unexpected.join(", ")}`).toEqual([]);
    expect(vercel["functions"], "serverless functions are forbidden on Hobby static hosting").toBeUndefined();
    expect(vercel["crons"], "cron jobs require paid hosting").toBeUndefined();

    for (const functionsDir of ["api", "functions", "apps/web/api"]) {
      expect(
        existsSync(path.join(REPO_ROOT, functionsDir)),
        `${functionsDir}/ would deploy serverless functions`,
      ).toBe(false);
    }
  });
});
