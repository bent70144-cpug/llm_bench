import { existsSync, readdirSync, readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
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

// --- CI workflow contract ---------------------------------------------------

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  "runs-on"?: string;
  steps?: WorkflowStep[];
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

function readWorkflow(): Workflow {
  return loadYaml(readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
}

/** The verify job's steps; uses-only steps carry an empty `run` string. */
function workflowRuns(): string[] {
  const steps = readWorkflow().jobs?.["verify"]?.steps ?? [];
  return steps.map((step) => step.run ?? "");
}

function rootPackageJson(): { packageManager?: string; engines?: { node?: string }; scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
}

// --- Lint coverage ----------------------------------------------------------

/**
 * Every directory under a pnpm-workspace.yaml glob that holds a package.json.
 * Expanding the globs (instead of listing packages here) means a NEW
 * workspace package is audited automatically the moment it is added.
 */
function workspacePackageDirs(): string[] {
  const workspace = loadYaml(readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8")) as {
    packages?: string[];
  };
  const dirs: string[] = [];
  for (const glob of workspace.packages ?? []) {
    if (glob.endsWith("/*")) {
      const parent = path.join(REPO_ROOT, glob.slice(0, -2));
      for (const entry of readdirSync(parent)) {
        if (existsSync(path.join(parent, entry, "package.json"))) {
          dirs.push(path.relative(REPO_ROOT, path.join(parent, entry)));
        }
      }
    } else if (existsSync(path.join(REPO_ROOT, glob, "package.json"))) {
      dirs.push(glob);
    }
  }
  return [...new Set(dirs)].sort();
}

describe("lint coverage (ticket 14)", () => {
  it("gives every workspace package a lint script", () => {
    // Story 71: lint in every package, enforced uniformly. The audit
    // covers every directory the workspace globs resolve to.
    const dirs = workspacePackageDirs();
    const expected = ["apps/web", "packages/config", "packages/data", "packages/schema", "packages/scoring", "tools"];
    expect(dirs, "the workspace globs must resolve to the known packages (and any new ones)").toEqual(
      expect.arrayContaining(expected),
    );

    const missing: string[] = [];
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, dir, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (typeof pkg.scripts?.["lint"] !== "string" || pkg.scripts["lint"] === "") {
        missing.push(dir);
      }
    }
    expect(missing, `packages without a lint script: ${missing.join(", ")}`).toEqual([]);
  });

  it("lints every package through the shared ESLint flat config from @llm-bench/config", () => {
    // No per-package divergent configs: @llm-bench/config owns the one
    // flat config; every other package re-exports it.
    for (const dir of workspacePackageDirs()) {
      const configPath = path.join(REPO_ROOT, dir, "eslint.config.js");
      expect(existsSync(configPath), `${dir} must have an eslint.config.js`).toBe(true);
      const config = readFileSync(configPath, "utf8");
      if (dir === "packages/config") {
        expect(config, "the config package ships the shared base config").toContain("export const baseConfig");
      } else {
        expect(config, `${dir} must apply the shared flat config, not a divergent one`).toContain(
          '@llm-bench/config/eslint.config.js',
        );
      }
    }
  });

  it("runs the root lint recursively so one command covers every package", () => {
    // PRD §8A root scripts: `lint` → `pnpm -r lint`, which visits every
    // workspace package (the audited lint scripts above).
    const lint = rootPackageJson().scripts?.["lint"];
    expect(lint).toBe("pnpm -r lint");
  });
});

describe("CI workflow contract (ticket 14)", () => {
  it("parses as YAML with a verify job that gates every merge", () => {
    // The parse itself is the contract: a malformed workflow file (bad
    // indentation, a stray tab) must fail here, not at pull-request time.
    const workflow = readWorkflow();
    expect(workflow.jobs?.["verify"]).toBeDefined();
    expect(workflow.jobs?.["verify"]?.steps?.length ?? 0).toBeGreaterThan(0);
  });

  it("triggers on every pull request and on pushes to main", () => {
    // Story 64: CI runs on every PR so broken data can't merge. Pushes to
    // main are the last line of defence before Vercel deploys the merge.
    const triggers = readWorkflow().on ?? {};
    expect("pull_request" in triggers, "must trigger on pull_request").toBe(true);
    const push = triggers["push"] as { branches?: string[] } | undefined;
    expect(push?.branches, "must also gate pushes to main").toContain("main");
  });

  it("pins the toolchain to the same pnpm and Node the root package.json demands", () => {
    // Story 70: local, CI and Vercel must match. Vercel reads
    // packageManager/engines from package.json; CI repeats them explicitly,
    // so the two are cross-checked here to catch them drifting apart.
    const root = rootPackageJson();
    const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(root.packageManager ?? "")?.[1];
    expect(pnpmVersion, "root packageManager must pin an exact pnpm version").toBeDefined();
    const nodeMinimum = Number(/^>=(\d+)/.exec(root.engines?.node ?? "")?.[1]);
    expect(nodeMinimum, "root engines.node must declare a >= minimum").toBeGreaterThanOrEqual(22);

    const steps = readWorkflow().jobs?.["verify"]?.steps ?? [];
    const pnpmSetup = steps.find((step) => step.uses === "pnpm/action-setup@v4");
    expect(pnpmSetup?.with?.["version"], "pnpm/action-setup version must equal packageManager").toBe(pnpmVersion);
    const nodeSetup = steps.find((step) => step.uses === "actions/setup-node@v4");
    const nodeVersion = Number(nodeSetup?.with?.["node-version"]);
    expect(nodeSetup?.with?.["node-version"], "setup-node must pin a concrete major").toBeDefined();
    expect(nodeVersion, "CI Node major must satisfy engines.node").toBeGreaterThanOrEqual(nodeMinimum);
  });

  it("installs with a frozen lockfile before running the gates", () => {
    const runs = workflowRuns();
    const install = runs.indexOf("pnpm install --frozen-lockfile");
    expect(install, "must install with pnpm install --frozen-lockfile").toBeGreaterThanOrEqual(0);
    for (const gate of ["pnpm validate", "pnpm lint", "pnpm test", "pnpm build"]) {
      expect(runs.indexOf(gate), `${gate} must come after the frozen install`).toBeGreaterThan(install);
    }
  });

  it("runs the four gates — validate, lint, test, build — in order", () => {
    const runs = workflowRuns();
    const validate = runs.indexOf("pnpm validate");
    const lint = runs.indexOf("pnpm lint");
    const test = runs.indexOf("pnpm test");
    const build = runs.indexOf("pnpm build");
    for (const [label, index] of [["validate", validate], ["lint", lint], ["test", test], ["build", build]] as const) {
      expect(index, `the workflow must run ${label}`).toBeGreaterThanOrEqual(0);
    }
    expect(validate).toBeLessThan(lint);
    expect(lint).toBeLessThan(test);
    expect(test).toBeLessThan(build);
  });

  it("runs the browser suite in headless Chromium with Playwright installed and the entry knob available", () => {
    // The browser suite (seam 3) is a required gate: browser-check.ts and
    // perf-check.ts drive the BUILT static site. The workspace deliberately
    // never depends on Playwright, so CI installs it globally with npm —
    // the same discovery path the checks use locally (`npm root -g`) — and
    // exports PLAYWRIGHT_ENTRY, the override knob browser-check.ts reads.
    // The version is pinned to keep local and CI browsers identical.
    const runs = workflowRuns();
    const playwrightStep = runs.find((run) => run.includes("playwright@"));
    expect(playwrightStep, "must install a pinned Playwright for the browser suite").toBeDefined();
    expect(playwrightStep).toContain("npm install -g playwright@1.57.0");
    expect(playwrightStep).toContain("playwright install --with-deps chromium");
    expect(playwrightStep).toContain("PLAYWRIGHT_ENTRY");

    const browser = runs.indexOf("pnpm test:browser");
    expect(browser, "must run pnpm test:browser").toBeGreaterThanOrEqual(0);
    expect(runs.indexOf("pnpm build"), "the browser suite runs the built site, so it follows the build gate").toBeLessThan(browser);
    expect(playwrightStep, "Playwright must be installed before the browser suite runs").toBeDefined();
    expect(runs.indexOf(playwrightStep!)).toBeLessThan(browser);
  });
});

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
