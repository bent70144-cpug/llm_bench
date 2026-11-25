import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Benchmark } from "@llm-bench/schema";
import { defaultSelectedBenchmarkIds } from "@llm-bench/scoring";
import { PERF_FIXTURE_MODEL_COUNT, writePerfFixture } from "./lib/perf-fixture";
import { startSpaStaticServer } from "./lib/spa-static-server";

/**
 * Performance check (ticket 13) — timing measurements against BUILT output,
 * driven by the sandbox's headless Chromium, like browser-check.ts (it is
 * deliberately NOT part of `pnpm test`; both run under `pnpm test:browser`,
 * and CI wiring is ticket 14).
 *
 * Two phases:
 *
 * A. Page load of the REAL site over a local static server (user story 53,
 *    "a typical broadband page load completes in under two seconds").
 *    Local serve is the honest proxy the spec asks for: the network hop is
 *    loopback (no latency, no throttling), so the measured number is
 *    DOM+JS+CSS fetch+parse+render — everything a broadband connection adds
 *    is the transfer of the ~120 kB gzipped payload, which at a typical
 *    10 Mbps broadband line is roughly 0.1 s. The bound therefore asserts
 *    the local number against 2 s with that headroom documented.
 *
 * B. The synthetic 220-Model fixture (user story 54, "the leaderboard stays
 *    responsive with 200+ Models loaded"): a fixture build aliases
 *    @llm-bench/data at a temp directory (see apps/web/vite.perf.config.ts
 *    and tools/src/lib/perf-fixture.ts — packages/data is never touched),
 *    and the interactions are timed on the built fixture site: the initial
 *    render of all 220 rows, a Benchmark-column sort, and a search filter.
 *
 * Every bound below is MACHINE-RELATIVE and intentionally generous (several
 * times the numbers measured on the development sandbox, which are printed
 * with each check): the goal is to catch order-of-magnitude regressions
 * (accidental O(n²) work, a lost key on the 220-row table), not to
 * benchmark hardware. The measured numbers on this machine are recorded in
 * notes/llm-bench/impl-13.md.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");

// --- Bounds (machine-relative; see the header comment) ---------------------

/** Story 53: the whole page load, served locally, stays under two seconds. */
const PAGE_LOAD_BUDGET_MS = 2_000;
/** Story 54: rendering all 220 fixture rows on first paint. */
const INITIAL_RENDER_BUDGET_MS = 1_500;
/** Story 54: one sort or filter interaction over 220 Models. */
const INTERACTION_BUDGET_MS = 1_000;

// --- Minimal structural types for the parts of Playwright we use -----------
// (Same shape as browser-check.ts; the two scripts stay independent so a
// failure or refactor of one never breaks the other.)

interface LocatorLike {
  first(): LocatorLike;
  last(): LocatorLike;
  count(): Promise<number>;
  textContent(): Promise<string | null>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
}

interface PageLike {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "commit" }): Promise<unknown>;
  locator(selector: string): LocatorLike;
  /** Evaluates a page expression (an IIFE string keeps it self-contained). */
  evaluate<T>(expression: string): Promise<T>;
  waitForFunction(expression: string, options?: { timeout?: number }): Promise<void>;
  on(event: "pageerror", listener: (error: Error) => void): void;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: { launch(options?: { headless?: boolean }): Promise<BrowserLike> };
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

// --- Check harness ---------------------------------------------------------

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL ${label}${detail === "" ? "" : ` — ${detail}`}`);
  }
}

async function step(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL ${name} — threw: ${String(error)}`);
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function discoverPlaywrightEntry(): string {
  const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim();
  const candidates = [
    process.env["PLAYWRIGHT_ENTRY"],
    path.join(globalRoot, "playwright", "index.js"),
    "/home/z/.npm-global/lib/node_modules/playwright/index.js",
  ].filter((candidate): candidate is string => candidate !== undefined && candidate !== "");
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Playwright was not found (tried: ${candidates.join(", ")}). ` +
      "Set PLAYWRIGHT_ENTRY to the playwright package's index.js.",
  );
}

/** A monotonic wall clock (ms) for timing measurements. */
const now = (): number => performance.now();

/**
 * The wall-clock milliseconds one measurement took, rounded to whole ms.
 * Timings are Node-side round trips (action dispatched → page settled), so
 * they are honest UPPER bounds of what the browser spent.
 */
function elapsed(startedAt: number): number {
  return Math.round(now() - startedAt);
}

/** The Model name of the first leaderboard row (its row header). */
const FIRST_ROW_NAME = `(() => {
  const th = document.querySelector("tbody th");
  return th === null ? "" : th.textContent;
})()`;

// --- Phase A: real site, local serve ----------------------------------------

async function runRealSitePhase(chromium: PlaywrightModule["chromium"]): Promise<void> {
  console.log("\nphase A: the real site's page load over a local static server");

  // A fresh production build of the real data (the same artifact a deploy
  // ships): tsc --noEmit + vite build, like `pnpm build`.
  const build = spawnSync("pnpm", ["build"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    console.error(`${build.stdout}\n${build.stderr}`);
    check("the real production build succeeds for the page-load measurement", false);
    return;
  }
  check("the real production build succeeds for the page-load measurement", true);

  const realModelCount = readJson<{ id: string }[]>(path.join(DATA_DIR, "models.json")).length;

  const server = await startSpaStaticServer(DIST_DIR);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    // One cold load: navigation start → the full table (its LAST row)
    // painted. This includes the bundle fetch from the server, parse, app
    // boot and React's initial commit — everything but real network latency.
    const startedAt = now();
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "commit" });
    await page.locator("tbody tr").last().waitFor({ state: "visible" });
    const loadMs = elapsed(startedAt);

    const rowCount = await page.locator("tbody tr").count();
    check(
      "the real leaderboard renders every Model row (real build, not a stale one)",
      rowCount === realModelCount,
      `${rowCount} rows, expected ${realModelCount}`,
    );

    // Supplementary in-page navigation timings for the record.
    const timings = await page.evaluate<{ responseEnd: number; dcl: number; load: number }>(
      "(() => { const n = performance.getEntriesByType('navigation')[0];" +
        " return n === undefined ? { responseEnd: -1, dcl: -1, load: -1 } :" +
        " { responseEnd: Math.round(n.responseEnd), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; })()",
    );
    console.log(
      `  measured: ${loadMs} ms local page load (HTML+JS+CSS over loopback, cold;` +
        ` responseEnd ${timings.responseEnd} ms, DOMContentLoaded ${timings.dcl} ms, load ${timings.load} ms)`,
    );

    check(
      `the real page load over a local serve completes under ${PAGE_LOAD_BUDGET_MS} ms` +
        " (broadband proxy: loopback removes only network latency; the ~120 kB" +
        " gzipped payload adds ≈0.1 s at 10 Mbps)",
      loadMs < PAGE_LOAD_BUDGET_MS,
      `${loadMs} ms`,
    );
    check("the real page load raised no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
}

// --- Phase B: the synthetic 220-Model fixture -------------------------------

async function runFixturePhase(chromium: PlaywrightModule["chromium"]): Promise<void> {
  console.log("\nphase B: the synthetic 220-Model fixture build (temp directory only)");

  // The fixture: 220 synthetic Models + their Primary scores, the real
  // catalogue files, and the index.ts module shim, all inside a temp dir.
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "llm-bench-perf-"));
  let server: Awaited<ReturnType<typeof startSpaStaticServer>> | undefined;
  let browser: BrowserLike | undefined;

  try {
    writePerfFixture(fixtureDir);

    // A production build of the SAME app code with @llm-bench/data aliased
    // at the fixture (apps/web/vite.perf.config.ts). NODE_ENV is pinned so
    // the bundle is minified exactly like a deploy.
    const build = spawnSync(
      "pnpm",
      ["--filter", "web", "exec", "vite", "build", "--config", "vite.perf.config.ts"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, LLM_BENCH_DATA_DIR: fixtureDir, NODE_ENV: "production" },
      },
    );
    if (build.status !== 0) {
      console.error(`${build.stdout}\n${build.stderr}`);
      check("the fixture build (aliased @llm-bench/data) succeeds", false);
      return;
    }
    check("the fixture build (aliased @llm-bench/data) succeeds", true);

    const catalogue = readJson<Benchmark[]>(path.join(fixtureDir, "benchmarks.json"));
    const sortBenchmarkName = catalogue.find(
      (benchmark) => defaultSelectedBenchmarkIds(catalogue)[0] === benchmark.id,
    )!.name;

    server = await startSpaStaticServer(path.join(fixtureDir, "dist"));
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    // Initial render (cold): navigation start → the LAST of the 220 rows
    // painted. The row-count assertion doubles as proof that the served
    // build really is the fixture build.
    const renderStartedAt = now();
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "commit" });
    await page.locator("tbody tr").last().waitFor({ state: "visible" });
    const initialRenderMs = elapsed(renderStartedAt);

    const rowCount = await page.locator("tbody tr").count();
    check(
      `the fixture leaderboard renders all ${PERF_FIXTURE_MODEL_COUNT} synthetic Model rows`,
      rowCount === PERF_FIXTURE_MODEL_COUNT,
      `${rowCount} rows`,
    );
    console.log(`  measured: ${initialRenderMs} ms initial render of ${rowCount} rows (cold load)`);
    check(
      `the ${PERF_FIXTURE_MODEL_COUNT}-Model leaderboard initial-renders under ${INITIAL_RENDER_BUDGET_MS} ms`,
      initialRenderMs < INITIAL_RENDER_BUDGET_MS,
      `${initialRenderMs} ms`,
    );

    // A sort interaction: clicking a Benchmark column's sort control must
    // visibly reorder the table (the first row's Model changes). Measured
    // twice — the first click also pays one-time JIT warm-up, the second is
    // the steady-state interaction; the bound is asserted on the second.
    const sortButton = page.locator(`thead button[aria-label="Sort by ${sortBenchmarkName}"]`);
    const sortTimes: number[] = [];
    for (let round = 1; round <= 2; round++) {
      const before = await page.evaluate<string>(FIRST_ROW_NAME);
      const startedAt = now();
      await sortButton.click();
      await page.waitForFunction(
        `(() => { const th = document.querySelector("tbody th");` +
          ` return th !== null && th.textContent !== ${JSON.stringify(before)}; })()`,
      );
      sortTimes.push(elapsed(startedAt));
    }
    console.log(
      `  measured: sorting 220 Models by the "${sortBenchmarkName}" column — ` +
        `${sortTimes[0]} ms (first click), ${sortTimes[1]} ms (steady state)`,
    );
    check(
      `sorting the ${PERF_FIXTURE_MODEL_COUNT}-Model leaderboard completes under ${INTERACTION_BUDGET_MS} ms (steady state)`,
      (sortTimes[1] ?? Number.POSITIVE_INFINITY) < INTERACTION_BUDGET_MS,
      `${sortTimes.join(" ms, ")} ms`,
    );

    // A filter interaction: typing in the search control narrows the table
    // from all 220 Models to the matching prefix ("Perf Fixture Model 1xx").
    // Measured twice like the sort; each round ends by clearing the search
    // (also the reset for the next round), and the narrowed row count is
    // read inside the second round before clearing.
    const search = page.locator('input[type="search"]');
    const filterTimes: number[] = [];
    let narrowedCount = 0;
    for (let round = 1; round <= 2; round++) {
      const startedAt = now();
      await search.fill("Perf Fixture Model 1");
      await page.waitForFunction(
        `document.querySelectorAll("tbody tr").length !== ${PERF_FIXTURE_MODEL_COUNT}`,
      );
      filterTimes.push(elapsed(startedAt));
      if (round === 2) {
        narrowedCount = await page.locator("tbody tr").count();
      }
      await search.fill("");
      await page.waitForFunction(
        `document.querySelectorAll("tbody tr").length === ${PERF_FIXTURE_MODEL_COUNT}`,
      );
    }
    console.log(
      `  measured: filtering 220 Models by search to ${narrowedCount} rows — ` +
        `${filterTimes[0]} ms (first keystroke round), ${filterTimes[1]} ms (steady state)`,
    );
    check(
      "the search filter visibly narrows the 220-Model table (and clears again)",
      narrowedCount > 0 && narrowedCount < PERF_FIXTURE_MODEL_COUNT,
      `${narrowedCount} rows for "Perf Fixture Model 1"`,
    );
    check(
      `search-filtering the ${PERF_FIXTURE_MODEL_COUNT}-Model leaderboard completes under ${INTERACTION_BUDGET_MS} ms (steady state)`,
      (filterTimes[1] ?? Number.POSITIVE_INFINITY) < INTERACTION_BUDGET_MS,
      `${filterTimes.join(" ms, ")} ms`,
    );

    check("the fixture interactions raised no page errors", pageErrors.length === 0, pageErrors.join(" | "));
    await page.close();
  } finally {
    if (browser !== undefined) await browser.close();
    if (server !== undefined) await server.close();
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// --- Script entry ------------------------------------------------------------

async function main(): Promise<number> {
  const playwrightEntry = discoverPlaywrightEntry();
  const imported = (await import(pathToFileURL(playwrightEntry).href)) as unknown as {
    default?: PlaywrightModule;
  } & PlaywrightModule;
  // The sandbox's playwright is CommonJS; under ESM interop its exports
  // (chromium, …) arrive as the default export.
  const { chromium } = imported.default ?? imported;

  await step("phase A: real site page load (local serve, broadband proxy)", () =>
    runRealSitePhase(chromium),
  );
  await step("phase B: 220-Model fixture responsiveness", () => runFixturePhase(chromium));

  if (failures.length > 0) {
    console.error(`\n${failures.length} performance check(s) FAILED:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("\nAll performance checks passed.");
  return 0;
}

process.exitCode = await main();
