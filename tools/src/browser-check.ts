import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { startSpaStaticServer } from "./lib/spa-static-server";

/**
 * Ticket 08 browser check — the built static site in headless Chromium,
 * driven through real history-API navigation. This is deliberately a
 * SEPARATE script (`pnpm test:browser`), not part of `pnpm test`; wiring it
 * into CI is ticket 14.
 *
 * Covers what the static bundle test cannot: direct navigation and refresh
 * on /benchmarks/<id> render the data-driven page, the leaderboard links to
 * every Benchmark page, unknown ids and unbuilt routes get their not-found
 * views, and the pages are keyboard-operable.
 *
 * Playwright is provided by the sandbox (1.57 + cached Chromium), not by
 * the workspace — its entry file is discovered below and can be overridden
 * with PLAYWRIGHT_ENTRY=<path to playwright's index.js>.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");

// --- Minimal structural types for the parts of Playwright we use ---------

interface LocatorLike {
  first(): LocatorLike;
  nth(index: number): LocatorLike;
  count(): Promise<number>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  click(): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible"; timeout?: number }): Promise<void>;
}

interface PageLike {
  goto(url: string, options?: { waitUntil?: "load" }): Promise<unknown>;
  reload(options?: { waitUntil?: "load" }): Promise<unknown>;
  goBack(): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  keyboard: { press(key: string): Promise<void> };
  locator(selector: string): LocatorLike;
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

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
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

// --- The checks ------------------------------------------------------------

async function runChecks(page: PageLike, base: string): Promise<void> {
  const catalogue = readJson<Benchmark[]>("benchmarks.json");
  const models = readJson<Model[]>("models.json");
  const scores = readJson<Score[]>("scores.json");

  const primaryScoresFor = (benchmarkId: string): Score[] =>
    scores.filter((score) => score.isPrimary && score.benchmarkId === benchmarkId);

  /** The visible text of the page body. */
  const bodyText = (): Promise<string> =>
    page.locator("body").first().textContent().then((text) => text ?? "");

  const pathname = (): string => new URL(page.url()).pathname;

  await step("direct navigation renders a Benchmark page from data", async () => {
    // A Benchmark with at least one Primary score, so the best-Score section
    // has real content to render.
    const benchmark = catalogue.find((entry) => primaryScoresFor(entry.id).length > 0);
    if (benchmark === undefined) {
      check("data has a Benchmark with a Primary score", false);
      return;
    }
    const benchmarkScores = primaryScoresFor(benchmark.id);
    const best = Math.max(...benchmarkScores.map((score) => score.value));
    const leaderNames = benchmarkScores
      .filter((score) => score.value === best)
      .map((score) => models.find((model) => model.id === score.modelId)?.name ?? score.modelId);

    await page.goto(`${base}/benchmarks/${benchmark.id}`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    check("h1 is the Benchmark name", (await page.locator("h1").textContent()) === benchmark.name);
    check(
      "document title names the Benchmark",
      (await page.title()) === `${benchmark.name} — LLM Bench`,
      await page.title(),
    );

    const body = await bodyText();
    check("description renders", body.includes(benchmark.description.slice(0, 100)));
    check("limitations render", body.includes(benchmark.limitations.slice(0, 100)));
    check(
      "evaluationSettingNotes render",
      body.includes(benchmark.evaluationSettingNotes.slice(0, 100)),
    );
    check("metric renders", body.includes(benchmark.metric));
    check(
      "source link points at the Benchmark source and shows its host",
      (await page.locator(".benchmark-facts a").getAttribute("href")) === benchmark.sourceUrl &&
        body.includes(new URL(benchmark.sourceUrl).hostname),
    );
    check(
      "best Score and its Model render (Primary scores only)",
      leaderNames.every((name) => body.includes(name)) && body.includes(String(best)),
    );

    // The Canonical sources ordering, as a readable provenance rule.
    const itemCount = await page.locator("ol.canonical-sources li").count();
    check(
      "canonical sources render in data order",
      itemCount === benchmark.canonicalSources.length &&
        (
          await Promise.all(
            Array.from({ length: itemCount }, (_, index) =>
              page.locator("ol.canonical-sources li").nth(index).textContent(),
            ),
          )
        ).every((text, index) => text?.startsWith(benchmark.canonicalSources[index]!.sourceType)),
    );

    check(
      "back-to-leaderboard link is first and points at /",
      (await page.locator(".back-link a").getAttribute("href")) === "/" &&
        (await page.locator(".back-link a").textContent()) === "Back to leaderboard",
    );
  });

  await step("refresh on a Benchmark route keeps working", async () => {
    const benchmark = catalogue.find((entry) => primaryScoresFor(entry.id).length > 0);
    if (benchmark === undefined) return;
    await page.goto(`${base}/benchmarks/${benchmark.id}`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("h1 still renders after refresh", (await page.locator("h1").textContent()) === benchmark.name);
    check("description still renders after refresh", (await bodyText()).includes(benchmark.description.slice(0, 100)));
  });

  await step("every Benchmark in the data package has a directly addressable page", async () => {
    for (const benchmark of catalogue) {
      await page.goto(`${base}/benchmarks/${benchmark.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      const h1 = await page.locator("h1").textContent();
      check(`h1 renders for ${benchmark.id}`, h1 === benchmark.name, h1 ?? "null");
      if (primaryScoresFor(benchmark.id).length === 0) {
        check(
          `no-score Benchmark shows n/a (${benchmark.id})`,
          (await bodyText()).includes("n/a"),
        );
      }
    }
  });

  await step("unknown Benchmark id gets a proper not-found view", async () => {
    await page.goto(`${base}/benchmarks/definitely-not-a-benchmark`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("h1 is Benchmark not found", (await page.locator("h1").textContent()) === "Benchmark not found");
    check("the unknown id is shown", (await bodyText()).includes("definitely-not-a-benchmark"));
  });

  await step("unbuilt routes fall through to the generic not-found page", async () => {
    for (const route of ["/models/some-model", "/compare"]) {
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(`h1 is Page not found on ${route}`, (await page.locator("h1").textContent()) === "Page not found");
    }
  });

  await step("the leaderboard links to Benchmark pages", async () => {
    const benchmark = catalogue.find((entry) => primaryScoresFor(entry.id).length > 0);
    if (benchmark === undefined) return;
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const headerLinkCount = await page
      .locator(`thead a[href="/benchmarks/${benchmark.id}"]`)
      .count();
    const selectionLinkCount = await page
      .locator(`fieldset.benchmarks-selection a[href="/benchmarks/${benchmark.id}"]`)
      .count();
    check("column header links to the page", headerLinkCount === 1);
    check("Benchmark selection links to the page", selectionLinkCount === 1);

    // Client-side navigation via a real link click.
    await page.locator(`thead a[href="/benchmarks/${benchmark.id}"]`).click();
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("click navigates to the Benchmark route", pathname() === `/benchmarks/${benchmark.id}`, page.url());
    check("h1 renders after the click", (await page.locator("h1").textContent()) === benchmark.name);
    check("focus moves to the page content", (await page.locator("main:focus").count()) === 1);

    // The browser back button (popstate) returns to the leaderboard.
    await page.goBack();
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("back button returns to the leaderboard", pathname() === "/");
    check("leaderboard h1 renders", (await page.locator("h1").textContent()) === "LLM Bench");
  });

  await step("keyboard navigation reaches the content", async () => {
    await page.goto(`${base}/benchmarks/mmlu-pro`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    await page.keyboard.press("Tab");
    const firstTabStop = await page.locator(":focus").first().textContent();
    check(
      "first tab stop is the back-to-leaderboard link",
      firstTabStop === "Back to leaderboard",
      firstTabStop ?? "nothing focused",
    );

    await page.keyboard.press("Enter");
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("Enter on the link returns to the leaderboard", pathname() === "/");
    check("leaderboard h1 renders", (await page.locator("h1").textContent()) === "LLM Bench");
  });
}

// --- Script entry ------------------------------------------------------------

async function main(): Promise<number> {
  console.log("browser check (ticket 08): building the web app…");
  const build = spawnSync("pnpm", ["build"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    console.error(`${build.stdout}\n${build.stderr}`);
    console.error("pnpm build failed — the browser check needs a fresh build.");
    return 1;
  }

  const server = await startSpaStaticServer(DIST_DIR);
  const base = `http://127.0.0.1:${server.port}`;
  console.log(`serving ${path.relative(REPO_ROOT, DIST_DIR)} at ${base}`);

  const playwrightEntry = discoverPlaywrightEntry();
  const imported = (await import(pathToFileURL(playwrightEntry).href)) as unknown as {
    default?: PlaywrightModule;
  } & PlaywrightModule;
  // The sandbox's playwright is CommonJS; under ESM interop its exports
  // (chromium, …) arrive as the default export.
  const { chromium } = imported.default ?? imported;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    await runChecks(page, base);
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }

  check("no page errors were raised", pageErrors.length === 0, pageErrors.join(" | "));

  if (failures.length > 0) {
    console.error(`\n${failures.length} browser check(s) FAILED:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("\nAll browser checks passed.");
  return 0;
}

process.exitCode = await main();
