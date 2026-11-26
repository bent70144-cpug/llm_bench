import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LICENSE_VALUES, type Benchmark, type Model, type PricingConfig, type Score } from "@llm-bench/schema";
import {
  bestValueByBenchmark,
  blendedPricePer1M,
  computeAverage,
  defaultSelectedBenchmarkIds,
  encodeLeaderboardUrlState,
  filterModels,
  isUnderHalfCoverage,
  modelDataCurrency,
  primaryScoreFor,
  RADAR_AXIS_CAP,
  rankModelsByAverage,
  selectRadarBenchmarks,
  selectedBenchmarks,
  sortModelsByColumn,
} from "@llm-bench/scoring";
import { startSpaStaticServer } from "./lib/spa-static-server";

/**
 * Browser check — the built static site in headless Chromium, driven
 * through real history-API navigation. This is deliberately a SEPARATE
 * script (`pnpm test:browser`), not part of `pnpm test`; wiring it into
 * CI is ticket 14.
 *
 * Ticket 08 covers the Benchmark detail pages: direct navigation and
 * refresh on /benchmarks/<id>, leaderboard links to every Benchmark page,
 * unknown ids and unbuilt routes get their not-found views, and the pages
 * are keyboard-operable. Ticket 07 adds the Score provenance checks: the
 * tooltip and the Score details panel over the leaderboard.
 *
 * Ticket 09 covers the Model detail pages: direct navigation and refresh
 * on /models/<id> for every Model, the data-currency header, facts with
 * null prices and Reference inference providers, the Model-versus-leaders
 * chart (n/a for gaps, never zero), the per-Benchmark Score sections with
 * alternate Evaluation settings, keyboard operability, and the
 * leaderboard's Model-name links.
 *
 * Ticket 05 covers the leaderboard's ranking and Coverage semantics: the
 * default ranked view, the (n/selected) Coverage beside every Average, the
 * Under 50% Coverage badge, instant recalculation on Benchmark toggles,
 * composed filter+search+sort, and Primary-only displayed cells.
 *
 * Ticket 06 covers Benchmark weights and shareable URL state: a weight
 * change reorders the rows and switches the aggregate label to Weighted
 * Average, the view is written to the URL as query parameters, and opening
 * or refreshing a shared URL restores the exact selection, weights, sorting,
 * search, and filters.
 *
 * Ticket 10 covers the compare view: selecting 2 to 4 Models with the
 * leaderboard's Compare checkboxes opens the side-by-side comparison, the
 * radar chart caps at 8 axes with a note naming the deprioritized
 * Benchmarks, the bar chart shows every selected Benchmark, missing values
 * read "n/a" on both charts and in the table, a shared comparison URL
 * survives refresh, the guard rails (<2, >4, unknown ids) render friendly
 * messages, and the flow is keyboard-operable.
 *
 * Ticket 13 covers accessibility, responsiveness and performance: light and
 * dark themes (WCAG AA contrast on every surface, a keyboard toggle that
 * announces its state, no flash of the wrong theme on reload), the mobile
 * 375px layout, and the keyboard walk (skip link, tab order, visible focus,
 * no traps). The performance budgets (page load, 200+ Models) are measured
 * by the sibling script perf-check.ts, which runs after this one under
 * pnpm test:browser.
 *
 * Ticket 12 covers the exports: three labelled, keyboard-operable controls
 * whose clicks produce real downloads (Playwright download events) — the
 * current filtered and sorted view as CSV and as JSON (selected Benchmark
 * columns, the active aggregate, Coverage, and Score provenance, all
 * reflecting the state at click time), and the full raw dataset as JSON,
 * including a non-Primary alternate Evaluation setting.
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
  inputValue(): Promise<string>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  focus(): Promise<void>;
  hover(): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  locator(selector: string): LocatorLike;
}

/** A Playwright download, structurally typed — ticket 12's export checks. */
interface DownloadLike {
  suggestedFilename(): string;
  path(): Promise<string>;
}

interface PageLike {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" }): Promise<unknown>;
  reload(options?: { waitUntil?: "load" | "domcontentloaded" }): Promise<unknown>;
  goBack(): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  keyboard: { press(key: string): Promise<void> };
  locator(selector: string): LocatorLike;
  on(event: "pageerror", listener: (error: Error) => void): void;
  close(): Promise<void>;
  /** Evaluates a page expression (an IIFE string keeps it self-contained). */
  evaluate<T>(expression: string): Promise<T>;
  emulateMedia(options: { colorScheme: "light" | "dark" | "no-preference" }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  waitForFunction(expression: string, options?: { timeout?: number }): Promise<void>;
  /** Waits for the next download event (ticket 12's export checks). */
  waitForEvent(event: "download", options?: { timeout?: number }): Promise<DownloadLike>;
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

// --- WCAG contrast helpers (ticket 13 scripted a11y audit) ------------------

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(color: string): RgbColor | null {
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (match === null) return null;
  const parts = match[1]!.split(",").map((part) => part.trim());
  return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]!), a: Number(parts[3] ?? "1") };
}

/** WCAG 2.x relative luminance of a parsed colour. */
function relativeLuminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  let bg = parseColor(background);
  if (fg === null || bg === null) return 0;
  // Composite a translucent foreground over its background first.
  if (fg.a < 1) {
    bg = {
      r: fg.a * fg.r + (1 - fg.a) * bg.r,
      g: fg.a * fg.g + (1 - fg.a) * bg.g,
      b: fg.a * fg.b + (1 - fg.a) * bg.b,
      a: 1,
    };
  }
  const l1 = relativeLuminance(fg.a < 1 ? bg! : fg);
  const l2 = relativeLuminance(bg!);
  const higher = Math.max(l1, l2);
  const lower = Math.min(l1, l2);
  return (higher + 0.05) / (lower + 0.05);
}

/** A page expression that samples how one element is painted. */
function paintSampleExpression(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element === null) return null;
    const style = getComputedStyle(element);
    let background = "rgba(0, 0, 0, 0)";
    for (let node = element; node !== null; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)") { background = color; break; }
    }
    return {
      color: style.color,
      background,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      borderColor: style.borderColor,
      text: element.textContent === null ? "" : element.textContent.slice(0, 40),
    };
  })()`;
}

interface PaintSample {
  color: string;
  background: string;
  outlineColor: string;
  outlineStyle: string;
  outlineWidth: string;
  borderColor: string;
  text: string;
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
    for (const route of ["/definitely-not-a-route"]) {
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

    // Ticket 13 site chrome: the skip link is the first tab stop, the theme
    // toggle second, then the page content begins with the back link.
    await page.keyboard.press("Tab");
    const firstTabStop = await page.locator(":focus").first().textContent();
    check(
      "first tab stop is the skip-to-content link",
      firstTabStop === "Skip to content",
      firstTabStop ?? "nothing focused",
    );

    await page.keyboard.press("Tab");
    check(
      "second tab stop is the theme toggle",
      (await page.locator("button.theme-toggle:focus").count()) === 1,
    );

    await page.keyboard.press("Tab");
    const thirdTabStop = await page.locator(":focus").first().textContent();
    check(
      "the tab order reaches the back-to-leaderboard link next",
      thirdTabStop === "Back to leaderboard",
      thirdTabStop ?? "nothing focused",
    );

    await page.keyboard.press("Enter");
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("Enter on the link returns to the leaderboard", pathname() === "/");
    check("leaderboard h1 renders", (await page.locator("h1").textContent()) === "LLM Bench");
  });

  await step("the skip link jumps keyboard users straight to the content (ticket 13)", async () => {
    await page.goto(`${base}/benchmarks/mmlu-pro`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    await page.keyboard.press("Tab");
    check(
      "the skip link is focusable as the first tab stop",
      (await page.locator("a.skip-link:focus").count()) === 1,
    );

    // Off-screen but never hidden-with-visibility/display, so it stays in the
    // tab order; focusing it slides it into view.
    const skipVisibility = await page.evaluate<{ visible: boolean; transform: string }>(
      "(() => { const el = document.activeElement; const s = el === null ? null : getComputedStyle(el);" +
        " const rect = el === null ? null : el.getBoundingClientRect();" +
        " return { visible: el !== null && s.visibility === 'visible' && s.display !== 'none' &&" +
        " rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight," +
        " transform: el === null ? 'none' : s.transform }; })()",
    );
    check(
      "the skip link becomes visible when focused",
      skipVisibility !== null && skipVisibility.visible,
      JSON.stringify(skipVisibility),
    );

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "document.activeElement !== null && document.activeElement.tagName === 'MAIN'",
    );
    check(
      "Enter on the skip link moves focus to the main content",
      (await page.locator("main:focus").count()) === 1,
    );
  });

  await step("Score cells expose provenance and a Score details panel (ticket 07)", async () => {
    // Everything under test is derived from the data package: a real pair
    // with alternate Evaluation settings on a core-Tier Benchmark (its
    // column is visible with the default selection) and a pair with only a
    // Primary score.
    const coreIds = new Set(catalogue.filter((b) => b.tier === "core").map((b) => b.id));
    const byPair = new Map<string, Score[]>();
    for (const score of scores) {
      const key = `${score.modelId}|${score.benchmarkId}`;
      byPair.set(key, [...(byPair.get(key) ?? []), score]);
    }
    const findPair = (withAlternates: boolean) => {
      for (const [key, pair] of byPair) {
        const [modelId, benchmarkId] = key.split("|") as [string, string];
        if (!coreIds.has(benchmarkId)) continue;
        if (withAlternates ? pair.length < 2 : pair.length !== 1) continue;
        const model = models.find((candidate) => candidate.id === modelId);
        const benchmark = catalogue.find((candidate) => candidate.id === benchmarkId);
        if (model === undefined || benchmark === undefined) continue;
        return { model, benchmark, pair };
      }
      return undefined;
    };
    const withAlternates = findPair(true);
    const withoutAlternates = findPair(false);
    if (withAlternates === undefined || withoutAlternates === undefined) {
      check("data has core-Tier pairs with and without alternate settings", false);
      return;
    }
    const primary = withAlternates.pair.find((score) => score.isPrimary)!;
    const alternates = withAlternates.pair.filter((score) => !score.isPrimary);

    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // The details control and the value anchor live in the same score cell.
    const detailsLabel = `Score details: ${withAlternates.model.name} on ${withAlternates.benchmark.name}`;
    const cellSpan = `span.score-cell:has(button[aria-label="${detailsLabel}"])`;
    const valueLink = page.locator(`${cellSpan} > a.score-link`).first();
    check(
      "the value cell is a real anchor to the Primary score's source URL",
      (await valueLink.getAttribute("href")) === primary.sourceUrl,
    );
    check(
      "the value cell shows the Primary score value",
      (await valueLink.textContent()) === String(primary.value),
    );

    // The provenance tooltip appears on hover…
    const tooltip = page.locator("[role=tooltip]");
    await valueLink.hover();
    await tooltip.waitFor({ state: "visible" });
    check("tooltip appears on hover", true);

    // …hides when the mouse leaves…
    await page.locator("h1").first().hover();
    await tooltip.waitFor({ state: "hidden" });
    check("tooltip hides when the mouse leaves", true);

    // …and is keyboard-reachable: it appears on focus and is named by the
    // anchor's aria-describedby.
    await valueLink.focus();
    await tooltip.waitFor({ state: "visible" });
    check("tooltip is keyboard-reachable (appears on focus)", true);
    const tooltipText = (await tooltip.textContent()) ?? "";
    check(
      "the anchor names the tooltip via aria-describedby",
      (await valueLink.getAttribute("aria-describedby")) ===
        (await tooltip.getAttribute("id")),
    );
    check(
      "tooltip shows Source type, Evaluation setting, publishedDate, and retrievedDate",
      tooltipText.includes(`Source type: ${primary.sourceType}`) &&
        tooltipText.includes(primary.evaluationSetting) &&
        tooltipText.includes(primary.publishedDate) &&
        tooltipText.includes(primary.retrievedDate),
    );
    check(
      "tooltip explains verified semantics: checked against the source, not independent reproduction",
      tooltipText.includes(
        "the data owner checked the value and Evaluation setting against the linked Source URL, not an independent reproduction",
      ),
    );

    // The Score details panel opens from the keyboard…
    const detailsButton = page.locator(`button[aria-label="${detailsLabel}"]`);
    await detailsButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("[role=dialog]");
    await dialog.waitFor({ state: "visible" });
    check("Enter on the details control opens the Score details panel", true);
    check(
      "focus moves into the dialog",
      (await page.locator("[role=dialog]:focus").count()) === 1,
    );

    const dialogText = (await dialog.textContent()) ?? "";
    check(
      "panel is titled with the Model and the Benchmark",
      dialogText.includes(
        `Score details: ${withAlternates.model.name} on ${withAlternates.benchmark.name}`,
      ),
    );
    check(
      "panel labels the Primary score with its full provenance",
      dialogText.includes("Primary score") &&
        dialogText.includes(String(primary.value)) &&
        dialogText.includes(primary.evaluationSetting) &&
        dialogText.includes(primary.sourceType) &&
        dialogText.includes(primary.publishedDate) &&
        dialogText.includes(primary.retrievedDate),
    );
    check(
      "panel links the Primary score to its source URL",
      (await page.locator(`[role=dialog] a[href="${primary.sourceUrl}"]`).count()) >= 1,
    );
    check(
      "panel lists every alternate Evaluation setting with its value and provenance",
      dialogText.includes("Alternate Evaluation setting") &&
        alternates.every(
          (score) =>
            dialogText.includes(String(score.value)) &&
            dialogText.includes(score.evaluationSetting) &&
            dialogText.includes(score.sourceType),
        ),
    );
    check(
      "panel notes that alternates are excluded from the Average and highlighting",
      dialogText.includes("Excluded from the Average"),
    );
    check(
      "panel explains verified semantics",
      dialogText.includes(
        "Verified means the data owner checked the value and Evaluation setting against the linked Source URL, not an independent reproduction",
      ),
    );

    // …and closes with Escape, returning focus to the trigger.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    check("Escape closes the panel", true);
    check(
      "focus returns to the details control",
      (await page.locator("button:focus").getAttribute("aria-label")) === detailsLabel,
    );

    // A pair with only a Primary score shows no alternate section.
    const plainLabel = `Score details: ${withoutAlternates.model.name} on ${withoutAlternates.benchmark.name}`;
    await page.locator(`button[aria-label="${plainLabel}"]`).click();
    await dialog.waitFor({ state: "visible" });
    const plainText = (await dialog.textContent()) ?? "";
    check(
      "a pair without alternates shows the Primary score and no alternate section",
      plainText.includes("Primary score") && !plainText.includes("Alternate Evaluation setting"),
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    check("Escape closes the no-alternates panel too", true);
  });

  // --- Ticket 05: the leaderboard's ranking and Coverage semantics ------

  /** The Model names of the leaderboard rows, top to bottom. */
  const rowNames = async (): Promise<string[]> => {
    const rowCount = await page.locator("tbody tr").count();
    const names: string[] = [];
    for (let index = 0; index < rowCount; index++) {
      names.push(
        (await page.locator("tbody tr").nth(index).locator("th").first().textContent()) ?? "",
      );
    }
    return names;
  };

  /** The full text of one Model's row, found by its Model name. */
  const rowTextByName = async (modelName: string): Promise<string> => {
    const rowCount = await page.locator("tbody tr").count();
    for (let index = 0; index < rowCount; index++) {
      const row = page.locator("tbody tr").nth(index);
      const name = (await row.locator("th").first().textContent()) ?? "";
      if (name === modelName) return (await row.textContent()) ?? "";
    }
    return "";
  };

  /**
   * The displayed Score text (and the cell's class) of one Benchmark cell
   * of one Model's row: `benchmarkId` must be among the selected Benchmarks.
   * The Score text is read from the score link — the value anchor — because
   * the cell also carries the ⓘ details control beside it (ticket 07), so
   * the raw cell text would include the glyph.
   */
  const benchmarkCell = async (
    modelName: string,
    benchmarkId: string,
  ): Promise<{ scoreText: string; className: string }> => {
    const selection = defaultSelectedBenchmarkIds(catalogue);
    const cellIndex =
      1 + // the row's Compare checkbox cell (ticket 10)
      7 + // the fixed Model-field cells after the row header (Provider … Coverage)
      selection.indexOf(benchmarkId);
    const rowCount = await page.locator("tbody tr").count();
    for (let index = 0; index < rowCount; index++) {
      const row = page.locator("tbody tr").nth(index);
      const name = (await row.locator("th").first().textContent()) ?? "";
      if (name === modelName) {
        const cell = row.locator("td").nth(cellIndex);
        return {
          scoreText: (await cell.locator("a.score-link").textContent()) ?? "",
          className: (await cell.getAttribute("class")) ?? "",
        };
      }
    }
    return { scoreText: "", className: "" };
  };

  const selection = defaultSelectedBenchmarkIds(catalogue);
  const leaderboardContext = { scores, benchmarkIds: selection };

  await step("the leaderboard opens ranked by Average descending, every Average with its Coverage", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const expected = rankModelsByAverage(models, leaderboardContext);
    const rowCount = await page.locator("tbody tr").count();
    check("every Model stays ranked — one row per Model", rowCount === models.length, `${rowCount} rows`);

    const names = await rowNames();
    check(
      "row order is the ranking (Average desc; equal Averages by higher Coverage then name)",
      JSON.stringify(names) === JSON.stringify(expected.map((model) => model.name)),
      names.slice(0, 3).join(" | "),
    );

    check(
      "the Average header announces the descending ranking",
      (await page.locator('thead th:has-text("Average")').first().getAttribute("aria-sort")) ===
        "descending",
    );

    // Every Average shows its Coverage as (n/selected); the leader leads
    // with a single Score, so its Coverage must read (1/12) — with a badge.
    const leader = expected[0]!;
    const leaderAverage = computeAverage(leader.id, scores, { benchmarkIds: selection });
    const leaderCell = await page.locator("tbody tr td.average-cell").first().textContent();
    check(
      "the leading Average carries its Coverage as (n/selected)",
      leaderCell?.includes(`(${leaderAverage.coverage}/${leaderAverage.selected})`) === true,
      leaderCell ?? "null",
    );
    check(
      "the leading Model is badged for under 50% Coverage",
      leaderCell?.includes("Under 50% Coverage") === true,
      leaderCell ?? "null",
    );

    // The badge is computed from the Coverage fraction: exactly the
    // under-50% Models carry it, and the exactly-50% boundary does not.
    const expectedBadged = models.filter((model) =>
      isUnderHalfCoverage(computeAverage(model.id, scores, { benchmarkIds: selection })),
    );
    const badgedCount = await page.locator("tbody .coverage-badge").count();
    check(
      "the badge appears on exactly the under-50% Models",
      badgedCount === expectedBadged.length,
      `${badgedCount} badges vs ${expectedBadged.length} expected`,
    );

    const boundary = models.find((model) => {
      const result = computeAverage(model.id, scores, { benchmarkIds: selection });
      return 2 * result.coverage === result.selected;
    });
    if (boundary !== undefined) {
      const boundaryResult = computeAverage(boundary.id, scores, { benchmarkIds: selection });
      const boundaryRow = await rowTextByName(boundary.name);
      check(
        `the exactly-50% Model (${boundary.name}) shows (n/selected) without the badge`,
        boundaryRow.includes(`(${boundaryResult.coverage}/${selection.length})`) &&
          !boundaryRow.includes("Under 50% Coverage"),
        boundaryRow.slice(0, 80),
      );
    }

    const footer = (await page.locator(".table-note").textContent()) ?? "";
    check(
      "the footer states the number of Benchmarks used",
      footer.includes(`Average over ${selection.length} selected Benchmarks`),
      footer.slice(0, 80),
    );
  });

  await step("toggling a Benchmark recalculates the ranking and the footer instantly", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // The leader's only selected Benchmark: unchecking it must drop the
    // leader to the null-Average group (bottom of the ranking).
    const ranked = rankModelsByAverage(models, leaderboardContext);
    const sparseLeader =
      ranked.find((model) => {
        const result = computeAverage(model.id, scores, { benchmarkIds: selection });
        return result.coverage === 1;
      }) ?? ranked[0]!;
    const leaderBenchmarkId = scores.find(
      (score) =>
        score.isPrimary &&
        score.modelId === sparseLeader.id &&
        selection.includes(score.benchmarkId),
    )!.benchmarkId;

    const checkboxIndex = catalogue.findIndex((benchmark) => benchmark.id === leaderBenchmarkId);
    const narrowedSelection = selection.filter((id) => id !== leaderBenchmarkId);
    const narrowedContext = { scores, benchmarkIds: narrowedSelection };
    const expectedNarrowed = rankModelsByAverage(models, narrowedContext);

    await page
      .locator("fieldset.benchmarks-selection label")
      .nth(checkboxIndex)
      .locator("input")
      .click();

    const footer = (await page.locator(".table-note").textContent()) ?? "";
    check(
      "the footer recounts the selected Benchmarks without a reload",
      footer.includes(`Average over ${narrowedSelection.length} selected Benchmarks`),
      footer.slice(0, 80),
    );

    const names = await rowNames();
    check(
      "the ranking recalculates instantly over the narrower selection",
      JSON.stringify(names) === JSON.stringify(expectedNarrowed.map((model) => model.name)),
      names.slice(0, 3).join(" | "),
    );

    const leaderRow = await rowTextByName(sparseLeader.name);
    check(
      "the Model that lost its only Benchmark shows n/a with (0/n) — never zero — and the badge",
      leaderRow.includes("n/a") &&
        leaderRow.includes(`(0/${narrowedSelection.length})`) &&
        leaderRow.includes("Under 50% Coverage"),
      leaderRow.slice(0, 90),
    );

    // Toggling the Benchmark back restores the original ranking.
    await page
      .locator("fieldset.benchmarks-selection label")
      .nth(checkboxIndex)
      .locator("input")
      .click();
    const restoredNames = await rowNames();
    check(
      "toggling the Benchmark back restores the ranking",
      JSON.stringify(restoredNames) === JSON.stringify(ranked.map((model) => model.name)),
    );
  });

  await step("search, License, price, and Context window filters compose with column sorting", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // Every expected list is computed from the data package via the
    // scoring package, so the check proves the UI applies the same
    // pipeline (filter → search → rank/sort), not a hardcoded list.
    const query = {
      search: "claude",
      licenses: ["proprietary"] as const,
      minContextWindow: 500_000,
    };
    const shortlist = filterModels(models, query);
    check("the composed fixture keeps a shortlist of Models", shortlist.length >= 2);

    await page.locator('input[type="search"]').fill(query.search);
    await page
      .locator('fieldset:has(legend:text-is("License")) label')
      .nth(LICENSE_VALUES.indexOf("proprietary"))
      .locator("input")
      .click();
    await page.locator('input[type="number"]').nth(0).fill(String(query.minContextWindow));

    let names = await rowNames();
    check(
      "search + License + Context window filter together, then rank",
      JSON.stringify(names) ===
        JSON.stringify(rankModelsByAverage(shortlist, leaderboardContext).map((model) => model.name)),
      names.join(" | "),
    );

    // Sorting the filtered shortlist by a Benchmark column reorders it.
    const tau2 = catalogue.find((benchmark) => benchmark.id === "tau2-bench");
    if (tau2 !== undefined) {
      await page.locator(`thead button[aria-label="Sort by ${tau2.name}"]`).click();
      names = await rowNames();
      check(
        "a Benchmark-column sort applies to the filtered shortlist",
        JSON.stringify(names) ===
          JSON.stringify(
            sortModelsByColumn(shortlist, { column: "tau2-bench", direction: "asc" }, leaderboardContext).map(
              (model) => model.name,
            ),
          ),
        names.join(" | "),
      );

      // Adding the price ceiling narrows the composed result further.
      await page.locator('input[type="number"]').nth(1).fill("4");
      const withPriceCeiling = filterModels(models, { ...query, maxInputPricePer1M: 4 });
      names = await rowNames();
      check(
        "the price ceiling composes with search, License, Context window, and the sort",
        JSON.stringify(names) ===
          JSON.stringify(
            sortModelsByColumn(
              withPriceCeiling,
              { column: "tau2-bench", direction: "asc" },
              leaderboardContext,
            ).map((model) => model.name),
          ),
        names.join(" | "),
      );
      check("the price ceiling narrowed the shortlist", (await page.locator("tbody tr").count()) < shortlist.length);
    }
  });

  await step("only Primary scores feed the displayed cells and the best-Score highlight", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // Claude Opus 4.5 on SWE-bench Verified: the Primary score is the
    // leaderboard's 74.4; its higher provider alternates (80.9 / 80.6)
    // must not display or feed anything.
    const opusPrimary = scores.find(
      (score) =>
        score.isPrimary &&
        score.modelId === "claude-opus-4-5" &&
        score.benchmarkId === "swebench-verified",
    );
    if (opusPrimary === undefined) {
      check("data has Claude Opus 4.5 on SWE-bench Verified", false);
      return;
    }
    const opusCell = await benchmarkCell("Claude Opus 4.5", "swebench-verified");
    check(
      "the displayed Score is the Primary score, not a higher alternate setting",
      opusCell.scoreText === String(opusPrimary.value),
      opusCell.scoreText,
    );

    // The highlighted best Score per Benchmark is the best PRIMARY score.
    const swebenchPrimaries = scores.filter(
      (score) => score.isPrimary && score.benchmarkId === "swebench-verified",
    );
    const best = Math.max(...swebenchPrimaries.map((score) => score.value));
    const bestModel = models.find(
      (model) =>
        swebenchPrimaries.find((score) => score.modelId === model.id && score.value === best) !==
        undefined,
    );
    if (bestModel !== undefined) {
      const bestCell = await benchmarkCell(bestModel.name, "swebench-verified");
      check(
        "the best-Score highlight marks the best Primary score",
        bestCell.className.includes("best") && bestCell.scoreText === String(best),
        `${bestModel.name}: "${bestCell.scoreText}" class="${bestCell.className}"`,
      );
    }
  });

  // --- Ticket 13: light and dark themes, keyboard, mobile ------------------

  /** The applied explicit theme, set by the no-flash script / the toggle. */
  const htmlTheme = (): Promise<string | undefined> =>
    page.evaluate<string | undefined>("document.documentElement.dataset.theme");

  /** The computed body background as an rgb() string. */
  const bodyBackground = (): Promise<string> =>
    page.evaluate<string>("getComputedStyle(document.body).backgroundColor");

  /** True when the body background is a dark paint (all channels low). */
  const bodyIsDark = async (): Promise<boolean> => {
    const color = parseColor(await bodyBackground());
    return color !== null && color.a > 0.9 && color.r < 80 && color.g < 80 && color.b < 80;
  };

  await step("the palette follows prefers-color-scheme when no choice is stored", async () => {
    await page.evaluate("localStorage.removeItem('llm-bench-theme')");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    check("no stored choice leaves the theme implicit (no data-theme attribute)", (await htmlTheme()) === undefined);
    check("a dark OS preference paints the dark palette", await bodyIsDark());

    await page.emulateMedia({ colorScheme: "light" });
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("a light OS preference paints the light palette", !(await bodyIsDark()));
  });

  await step("the theme toggle switches, announces its state, and persists", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const toggle = page.locator("button.theme-toggle");
    check("the theme toggle renders once in the header", (await toggle.count()) === 1);
    check(
      "the toggle announces its state (aria-pressed, currently light)",
      (await toggle.getAttribute("aria-pressed")) === "false",
    );
    check(
      "the toggle's label names the current theme",
      ((await toggle.textContent()) ?? "").includes("Light"),
    );

    // Keyboard operation: focus the toggle and activate it with Space.
    await toggle.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction("document.documentElement.dataset.theme === 'dark'");
    check("Space on the focused toggle switches to the dark theme", (await htmlTheme()) === "dark");
    check("the dark palette is applied", await bodyIsDark());
    check(
      "the toggle state and label update (pressed, Dark)",
      (await toggle.getAttribute("aria-pressed")) === "true" &&
        ((await toggle.textContent()) ?? "").includes("Dark"),
    );
    check(
      "the choice persists in localStorage",
      (await page.evaluate<string>("localStorage.getItem('llm-bench-theme')")) === "dark",
    );

    // An explicit choice wins over the OS preference.
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload({ waitUntil: "domcontentloaded" });
    // At DOMContentLoaded the no-flash script has already run (it is the
    // first thing in <head>), so the stored theme is applied before any
    // React code or paint of the app.
    check("the stored theme is applied before the app boots (no flash)", (await htmlTheme()) === "dark");
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("the dark palette survives the reload", await bodyIsDark());
    check("the toggle still reads pressed after the reload", (await toggle.getAttribute("aria-pressed")) === "true");

    // Switch back with Enter; the light choice persists the same way.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction("document.documentElement.dataset.theme === 'light'");
    check("Enter on the toggle switches back to the light theme", (await htmlTheme()) === "light");
    check(
      "the light choice is stored too",
      (await page.evaluate<string>("localStorage.getItem('llm-bench-theme')")) === "light",
    );

    // Leave the page clean for the remaining checks.
    await page.evaluate("localStorage.removeItem('llm-bench-theme')");
  });

  await step("text and UI colours meet WCAG contrast in both themes", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // One representative sample per recurring paint role, asserted in both
    // themes: normal-size text needs 4.5:1; UI affordances (focus outline,
    // input borders) need 3:1 (WCAG 2.2 AA).
    const textSamples: readonly [label: string, selector: string][] = [
      ["body intro text", "p.page-intro"],
      ["table footer note", "p.table-note"],
      ["Benchmark column link", "thead th a.column-link"],
      ["Coverage count metadata", "td.average-cell .coverage-count"],
      ["missing-Score marker", "tbody .missing"],
      ["Under 50% Coverage badge", "tbody .coverage-badge"],
      ["sort control label", "thead button.sort-button"],
      ["Score details control", "tbody button.score-details-button"],
      ["best-Score cell link", "tbody td.best a"],
      ["Benchmark weights hint", ".weights-hint"],
      ["price chart axis title", ".scatter-svg .axis-title"],
      ["self-hosted Model list item", ".self-hosted-list li"],
    ];
    const uiSamples: readonly [label: string, selector: string][] = [
      ["number-input border", "input[type='number']"],
      ["theme-toggle border", "button.theme-toggle"],
      ["weight-input border", "fieldset.weights-selection input[type='number']"],
    ];

    const auditTheme = async (themeName: string): Promise<void> => {
      for (const [label, selector] of textSamples) {
        const sample = await page.evaluate<PaintSample | null>(paintSampleExpression(selector));
        const ratio = sample === null ? 0 : contrastRatio(sample.color, sample.background);
        check(
          `${themeName} theme: ${label} meets 4.5:1 contrast`,
          ratio >= 4.5,
          sample === null ? `${selector} not found` : `${sample.color} on ${sample.background} = ${ratio.toFixed(2)}:1`,
        );
      }
      for (const [label, selector] of uiSamples) {
        const sample = await page.evaluate<PaintSample | null>(paintSampleExpression(selector));
        const ratio = sample === null ? 0 : contrastRatio(sample.borderColor, sample.background);
        check(
          `${themeName} theme: ${label} meets 3:1 non-text contrast`,
          ratio >= 3,
          sample === null ? `${selector} not found` : `border ${sample.borderColor} on ${sample.background} = ${ratio.toFixed(2)}:1`,
        );
      }
      // The focus indicator must be visible against the painted background
      // of the focused control (3:1, WCAG 2.2 focus-appearance). A Tab press
      // first establishes keyboard modality so :focus-visible applies to the
      // programmatically focused control (mirroring a keyboard user).
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const focusSample = await page.evaluate<PaintSample | null>(
        "(() => { const el = document.activeElement; if (el === null || el === document.body) return null;" +
          " let background = 'rgba(0, 0, 0, 0)';" +
          " for (let node = el; node !== null; node = node.parentElement) {" +
          "  const c = getComputedStyle(node).backgroundColor;" +
          "  if (c !== 'rgba(0, 0, 0, 0)') { background = c; break; } }" +
          " const s = getComputedStyle(el);" +
          " return { color: s.color, background, outlineColor: s.outlineColor, outlineStyle: s.outlineStyle," +
          "  outlineWidth: s.outlineWidth, borderColor: s.borderColor, text: el.textContent === null ? '' : el.textContent.slice(0, 40) }; })()",
      );
      const outlineRatio =
        focusSample === null ? 0 : contrastRatio(focusSample.outlineColor, focusSample.background);
      check(
        `${themeName} theme: keyboard focus indicator is a visible outline (≥3:1, ≥2px)`,
        focusSample !== null &&
          focusSample.outlineStyle !== "none" &&
          parseFloat(focusSample.outlineWidth) >= 2 &&
          outlineRatio >= 3,
        focusSample === null ? "nothing focused" : `${focusSample.outlineColor} ${focusSample.outlineWidth} on ${focusSample.background} = ${outlineRatio.toFixed(2)}:1`,
      );
    };

    // Light theme: focus the search box (a main control) and audit.
    await page.locator("input[type='search']").focus();
    await auditTheme("light");

    // Dark theme via the toggle, focus a sort control in the table header.
    await page.locator("button.theme-toggle").click();
    await page.waitForFunction("document.documentElement.dataset.theme === 'dark'");
    await page.locator("thead button.sort-button").first().focus();
    await auditTheme("dark");

    // Back to the implicit light preference for the remaining checks.
    await page.evaluate("localStorage.removeItem('llm-bench-theme')");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
  });

  await step("Benchmark pages and the Score panels meet WCAG contrast in both themes", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate("localStorage.removeItem('llm-bench-theme')");

    /** One 4.5:1 text-contrast assertion per sample of an audited surface. */
    const auditSurface = async (
      themeName: string,
      surface: string,
      textSamples: readonly [label: string, selector: string][],
      uiSamples: readonly [label: string, selector: string][] = [],
    ): Promise<void> => {
      for (const [label, selector] of textSamples) {
        const sample = await page.evaluate<PaintSample | null>(paintSampleExpression(selector));
        const ratio = sample === null ? 0 : contrastRatio(sample.color, sample.background);
        check(
          `${themeName} theme, ${surface}: ${label} meets 4.5:1 contrast`,
          ratio >= 4.5,
          sample === null
            ? `${selector} not found`
            : `${sample.color} on ${sample.background} = ${ratio.toFixed(2)}:1`,
        );
      }
      for (const [label, selector] of uiSamples) {
        const sample = await page.evaluate<PaintSample | null>(paintSampleExpression(selector));
        const ratio = sample === null ? 0 : contrastRatio(sample.borderColor, sample.background);
        check(
          `${themeName} theme, ${surface}: ${label} meets 3:1 non-text contrast`,
          ratio >= 3,
          sample === null
            ? `${selector} not found`
            : `border ${sample.borderColor} on ${sample.background} = ${ratio.toFixed(2)}:1`,
        );
      }
    };

    /** Toggles to the explicit `target` theme and waits for it to paint. */
    const switchTheme = async (target: "dark" | "light"): Promise<void> => {
      await page.locator("button.theme-toggle").click();
      await page.waitForFunction(`document.documentElement.dataset.theme === '${target}'`);
    };

    // A scored Benchmark page that also renders URL patterns (so the
    // url-patterns hint is audited too); any Benchmark is data-derived.
    const auditBenchmark =
      catalogue.find(
        (entry) =>
          primaryScoresFor(entry.id).length > 0 &&
          entry.canonicalSources.some((source) => source.urlPatterns !== undefined),
      ) ?? catalogue.find((entry) => primaryScoresFor(entry.id).length > 0);
    if (auditBenchmark === undefined) {
      check("data has a scored Benchmark for the page audit", false);
      return;
    }

    // The Benchmark page (light, then dark via the toggle).
    const benchmarkSamples: readonly [label: string, selector: string][] = [
      ["Benchmark facts term", ".benchmark-facts dt"],
      ["Benchmark facts value", ".benchmark-facts dd"],
      ["Benchmark Source link", ".benchmark-facts a"],
      ["description text", "p.page-intro"],
      ["Canonical sources entry", ".canonical-sources li"],
      ["Canonical sources URL pattern hint", ".url-patterns"],
      ["Current best Primary score entry", ".best-scores li"],
      ["best-Primary-score source link", ".best-scores a"],
    ];
    await page.goto(`${base}/benchmarks/${auditBenchmark.id}`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    await auditSurface("light", "Benchmark page", benchmarkSamples);
    await switchTheme("dark");
    await auditSurface("dark", "Benchmark page", benchmarkSamples);

    // The Score details panel over the leaderboard. It is reopened per
    // theme because an open dialog would swallow the toggle click.
    const panelSamples: readonly [label: string, selector: string][] = [
      ["provenance term", "[role=dialog] .score-provenance dt"],
      ["provenance value", "[role=dialog] .score-provenance dd"],
      ["panel source link", "[role=dialog] .score-provenance a"],
      ["verified-semantics note", "[role=dialog] .detail-note"],
    ];
    const panelUiSamples: readonly [label: string, selector: string][] = [
      ["panel close-button border", "[role=dialog] .dialog-close"],
    ];
    const openPanel = async (): Promise<void> => {
      await page.locator("tbody button.score-details-button").first().click();
      await page.locator("[role=dialog]").waitFor({ state: "visible" });
    };
    const closePanel = async (): Promise<void> => {
      await page.keyboard.press("Escape");
      await page.locator("[role=dialog]").waitFor({ state: "hidden" });
    };

    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    await openPanel();
    await auditSurface("dark", "Score details panel", panelSamples, panelUiSamples);
    await closePanel();
    await switchTheme("light");
    await openPanel();
    await auditSurface("light", "Score details panel", panelSamples, panelUiSamples);
    await closePanel();

    // The provenance tooltip: hover a Score value anchor per theme (the
    // hover is dropped between themes so the toggle stays clickable).
    const tooltipSamples: readonly [label: string, selector: string][] = [
      ["tooltip provenance text", "[role=tooltip] p"],
      ["tooltip hint text", "[role=tooltip] .tooltip-hint"],
    ];
    const hoverScore = async (): Promise<void> => {
      await page.locator("tbody a.score-link").first().hover();
      await page.locator("[role=tooltip]").waitFor({ state: "visible" });
    };
    const unhover = async (): Promise<void> => {
      await page.locator("h1").first().hover();
      await page.locator("[role=tooltip]").waitFor({ state: "hidden" });
    };

    await hoverScore();
    await auditSurface("light", "Score tooltip", tooltipSamples);
    await unhover();
    await switchTheme("dark");
    await hoverScore();
    await auditSurface("dark", "Score tooltip", tooltipSamples);
    await unhover();

    // Leave the page clean for the remaining checks.
    await page.evaluate("localStorage.removeItem('llm-bench-theme')");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
  });

  await step("the wide table scrolls inside its own container on mobile (ticket 13)", async () => {
    // 375px: a common phone width. The table has 20 columns, so its content
    // is far wider than the screen — the container must scroll, the page
    // must not.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const layout = await page.evaluate<{
      pageOverflows: boolean;
      pageScrollWidth: number;
      pageClientWidth: number;
      containerScrolls: boolean;
      containerScrollWidth: number;
      containerClientWidth: number;
    }>(`(() => {
      const doc = document.documentElement;
      const scroller = document.querySelector(".table-scroll");
      return {
        pageOverflows: doc.scrollWidth > doc.clientWidth,
        pageScrollWidth: doc.scrollWidth,
        pageClientWidth: doc.clientWidth,
        containerScrolls: scroller !== null && scroller.scrollWidth > scroller.clientWidth,
        containerScrollWidth: scroller === null ? 0 : scroller.scrollWidth,
        containerClientWidth: scroller === null ? 0 : scroller.clientWidth,
      };
    })()`);
    check(
      "at 375px the table wrapper scrolls horizontally (wide content, own container)",
      layout.containerScrolls,
      `container ${layout.containerScrollWidth}px > ${layout.containerClientWidth}px?`,
    );
    check(
      "at 375px the page itself does not overflow (layout intact)",
      !layout.pageOverflows,
      `document ${layout.pageScrollWidth}px > ${layout.pageClientWidth}px?`,
    );

    const scrolled = await page.evaluate<number>(
      "(() => { const s = document.querySelector('.table-scroll'); s.scrollLeft = 400; return s.scrollLeft; })()",
    );
    check("the table wrapper actually scrolls sideways", scrolled > 0, `scrollLeft ${scrolled}`);
    const stillIntact = await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    );
    check("the page still does not overflow after scrolling the table", stillIntact);

    // Benchmark pages stay usable at phone width.
    const scored = catalogue.find((entry) => primaryScoresFor(entry.id).length > 0);
    if (scored !== undefined) {
      await page.goto(`${base}/benchmarks/${scored.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      const benchmarkOverflows = await page.evaluate<boolean>(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth",
      );
      check("a Benchmark page does not overflow at 375px", !benchmarkOverflows);
      check(
        "the Benchmark facts render at 375px",
        (await page.locator(".benchmark-facts").count()) === 1,
      );
    }

    // The Score details panel stays usable at phone width: it fits inside
    // the viewport (the backdrop scrolls vertically for tall content).
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    await page.locator("tbody button.score-details-button").first().click();
    const dialog = page.locator("[role=dialog]");
    await dialog.waitFor({ state: "visible" });
    const dialogFits = await page.evaluate<{ fits: boolean; detail: string }>(
      "(() => { const el = document.querySelector('[role=dialog]'); if (el === null) return { fits: false, detail: 'missing' };" +
        " const r = el.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= window.innerWidth && r.width > 200," +
        ` detail: 'left ' + Math.round(r.left) + ', right ' + Math.round(r.right) + ' of ' + window.innerWidth }; })()`,
    );
    check("the Score details panel fits the 375px viewport", dialogFits.fits, dialogFits.detail);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    // Back to the desktop viewport the remaining checks assume.
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await step("keyboard users reach and operate the main leaderboard controls (ticket 13)", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    /**
     * Description of the currently focused element for tab-order checks:
     * its index among the page's focusable elements (so two same-shaped
     * controls never look identical) plus tag, type, and classes.
     */
    const focusedElement = (): Promise<string> =>
      page.evaluate<string>(`(() => {
        const el = document.activeElement;
        if (el === null) return "none";
        const focusables = Array.from(
          document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"),
        );
        const index = focusables.indexOf(el);
        const label = el.getAttribute("aria-label") ?? "";
        const id = el.id === "" ? "" : "#" + el.id;
        const type =
          el.tagName === "INPUT" && el.getAttribute("type") !== null
            ? "[" + el.getAttribute("type") + "]"
            : "";
        const classes =
          typeof el.className === "string" && el.className !== ""
            ? "." + el.className.trim().split(/\\s+/).join(".")
            : "";
        return (
          index + ": " + el.tagName.toLowerCase() + id + type + classes +
          (label === "" ? "" : " [" + label + "]")
        );
      })()`);

    /** Computed focus outline of the focused element. */
    const focusedOutline = (): Promise<{ style: string; width: string } | null> =>
      page.evaluate<{ style: string; width: string } | null>(
        "(() => { const el = document.activeElement; if (el === null) return null;" +
          " const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth }; })()",
      );

    // The logical tab order: skip link → theme toggle → search → filters →
    // Benchmark selection → the table controls.
    await page.keyboard.press("Tab");
    const stop1 = await focusedElement();
    check("Tab 1 reaches the skip link", stop1.endsWith("a.skip-link"), stop1);

    await page.keyboard.press("Tab");
    const stop2 = await focusedElement();
    check("Tab 2 reaches the theme toggle", stop2.endsWith("button.theme-toggle"), stop2);

    await page.keyboard.press("Tab");
    const stop3 = await focusedElement();
    check("Tab 3 reaches the search control", stop3.endsWith("input[search]"), stop3);
    const outline = await focusedOutline();
    check(
      "the focused search control paints a visible focus outline",
      outline !== null && outline.style !== "none" && parseFloat(outline.width) >= 2,
      JSON.stringify(outline),
    );

    // Skip-link activation, then continue from the top of the content.
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "document.activeElement !== null && document.activeElement.tagName === 'MAIN'",
    );
    check("the skip link works on the leaderboard too", (await page.locator("main:focus").count()) === 1);

    // Tabbing from the top always moves forward: a keyboard trap would keep
    // landing on the same element. 40 consecutive Tabs must visit 40
    // distinct elements (the page has far more focusable controls than
    // that: filters, Benchmark selection, every column header, and every
    // Score cell anchor and details control).
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const stops: string[] = [];
    for (let index = 0; index < 40; index++) {
      await page.keyboard.press("Tab");
      stops.push(await focusedElement());
    }
    const distinctStops = new Set(stops).size;
    check(
      "no keyboard trap: 40 consecutive Tabs visit 40 distinct controls",
      distinctStops === 40,
      `${distinctStops} distinct stops; first repeat: ${
        stops.find((value, index) => stops.indexOf(value) !== index) ?? "none"
      }`,
    );

    // Every keyboard stop paints a visible focus outline (the whole walk
    // stayed in keyboard modality).
    const missingOutlines: string[] = [];
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press("Tab");
      const sample = await focusedOutline();
      if (sample === null || sample.style === "none" || parseFloat(sample.width) < 2) {
        missingOutlines.push(`${await focusedElement()}: ${JSON.stringify(sample)}`);
      }
    }
    check(
      "each of the first 15 keyboard stops paints a visible focus outline",
      missingOutlines.length === 0,
      missingOutlines.join(" | "),
    );
  });

  // --- Ticket 06: Benchmark weights and shareable URL state ---------------

  /** The aggregate column header's button text ("Average ▼" / "Weighted Average ▼"). */
  const aggregateHeaderText = async (): Promise<string> =>
    (await page.locator("thead th").nth(7).locator("button").textContent()) ?? "";

  /** The current URL's query string (without the leading "?"). */
  const queryString = (): string => new URL(page.url()).search.replace(/^\?/, "");

  await step("a Benchmark weight reorders the rows, switches the label, and lands in the URL", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const swebench = catalogue.find((benchmark) => benchmark.id === "swebench-verified");
    if (swebench === undefined) {
      check("data has SWE-bench Verified", false);
      return;
    }

    const plainRanked = rankModelsByAverage(models, leaderboardContext);
    check(
      "the aggregate header reads Average before any weight is set",
      (await aggregateHeaderText()).startsWith("Average"),
      await aggregateHeaderText(),
    );
    check(
      "the app writes the view to the URL on load",
      queryString().startsWith("benchmarks="),
      queryString().slice(0, 60),
    );

    // Weight SWE-bench Verified ×2 through its labeled control.
    const weightInput = page
      .locator(`fieldset.weights-selection label.weight-option:has-text("${swebench.name}")`)
      .locator("input");
    await weightInput.click();
    await weightInput.fill("2");

    const weightedContext = {
      scores,
      benchmarkIds: selection,
      weights: { "swebench-verified": 2 },
    };
    const expectedWeighted = rankModelsByAverage(models, weightedContext);
    check(
      "the aggregate header switches to Weighted Average",
      (await aggregateHeaderText()).startsWith("Weighted Average"),
      await aggregateHeaderText(),
    );
    const names = await rowNames();
    check(
      "the rows re-rank by the Weighted Average instantly",
      JSON.stringify(names) === JSON.stringify(expectedWeighted.map((model) => model.name)),
      names.slice(0, 3).join(" | "),
    );
    check(
      "Claude Sonnet 4.6 overtakes Claude Opus 4.6 when SWE-bench Verified counts double",
      names.indexOf("Claude Sonnet 4.6") < names.indexOf("Claude Opus 4.6"),
    );
    // Hand-computed from the data package: Opus 4.6's Weighted Average is
    // (91.31 + 99.79 + 91.89 + 2·75.6) / 5 = 86.838 → 86.8, with its
    // Coverage still (4/12) — Coverage is unweighted.
    const opusRow = await rowTextByName("Claude Opus 4.6");
    check(
      "the weighted value and the unweighted Coverage render (86.8, (4/12))",
      opusRow.includes("86.8") && opusRow.includes("(4/12)"),
      opusRow.slice(0, 90),
    );
    const footer = (await page.locator(".table-note").textContent()) ?? "";
    check(
      "the footer states the Weighted Average and the Benchmark count",
      footer.includes("Weighted Average over 12 selected Benchmarks"),
      footer.slice(0, 90),
    );
    check(
      "the weight lands in the URL",
      queryString().includes("weights=swebench-verified:2"),
      queryString(),
    );

    // Refresh: the URL restores selection, weights, and view exactly.
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const reloadedNames = await rowNames();
    check(
      "a reload of the weighted URL restores the exact ranking",
      JSON.stringify(reloadedNames) === JSON.stringify(expectedWeighted.map((model) => model.name)),
    );
    check(
      "the aggregate header still reads Weighted Average after the reload",
      (await aggregateHeaderText()).startsWith("Weighted Average"),
    );
    check("the weight input still reads 2 after the reload", (await weightInput.inputValue()) === "2");

    // Back to the default weight: the label switches back and the URL drops
    // the weights parameter.
    await weightInput.fill("1");
    check(
      "the aggregate header switches back to Average at the default weight",
      (await aggregateHeaderText()).startsWith("Average"),
      await aggregateHeaderText(),
    );
    const restoredNames = await rowNames();
    check(
      "the ranking returns to the plain Average order",
      JSON.stringify(restoredNames) === JSON.stringify(plainRanked.map((model) => model.name)),
    );
    check("the URL drops the weights parameter", !queryString().includes("weights="), queryString());

    // A weight of 0 excludes the Benchmark from the aggregate but keeps it
    // selected for Coverage — the documented 0-choice.
    await weightInput.fill("0");
    const excluded = rankModelsByAverage(models, {
      scores,
      benchmarkIds: selection,
      weights: { "swebench-verified": 0 },
    });
    const excludedNames = await rowNames();
    check(
      "a weight of 0 excludes the Benchmark: the rows re-rank, the label stays Weighted Average",
      JSON.stringify(excludedNames) === JSON.stringify(excluded.map((model) => model.name)) &&
        (await aggregateHeaderText()).startsWith("Weighted Average"),
      excludedNames.slice(0, 3).join(" | "),
    );
    check(
      "the weight of 0 lands in the URL",
      queryString().includes("weights=swebench-verified:0"),
      queryString(),
    );
  });

  await step("opening a shared URL restores the exact selection, weights, sorting, and filters", async () => {
    // A URL built by the scoring package's encoder — the same string the app
    // writes — carrying a two-Benchmark selection, a doubled MMLU-Pro
    // weight, a GPQA Diamond sort, a search, a License filter, and compared
    // Model ids (reserved for the compare view).
    const gpqa = catalogue.find((benchmark) => benchmark.id === "gpqa-diamond");
    const mmluPro = catalogue.find((benchmark) => benchmark.id === "mmlu-pro");
    if (gpqa === undefined || mmluPro === undefined) {
      check("data has GPQA Diamond and MMLU-Pro", false);
      return;
    }
    const sharedQuery = encodeLeaderboardUrlState({
      benchmarkIds: ["mmlu-pro", "gpqa-diamond"],
      weights: { "mmlu-pro": 2 },
      sort: { column: "gpqa-diamond", direction: "desc" },
      search: "claude",
      licenses: ["proprietary"],
      providers: [],
      comparedModelIds: ["claude-opus-4-6", "claude-sonnet-4-6"],
    });
    const expectedRows = sortModelsByColumn(
      filterModels(models, { search: "claude", licenses: ["proprietary"] }),
      { column: "gpqa-diamond", direction: "desc" },
      { scores, benchmarkIds: ["mmlu-pro", "gpqa-diamond"], weights: { "mmlu-pro": 2 } },
    );

    await page.goto(`${base}/?${sharedQuery}`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    const names = await rowNames();
    check(
      "the shared URL restores the exact filtered, sorted, weighted view",
      JSON.stringify(names) === JSON.stringify(expectedRows.map((model) => model.name)),
      names.join(" | "),
    );
    check(
      "the aggregate header reads Weighted Average (a weight is active on the selection)",
      (await aggregateHeaderText()).startsWith("Weighted Average"),
    );
    check(
      "the GPQA Diamond column announces the restored descending sort",
      (await page.locator(`thead th:has-text("${gpqa.name}")`).first().getAttribute("aria-sort")) ===
        "descending",
    );
    check(
      "exactly the two shared Benchmarks are selected",
      (await page.locator("fieldset.benchmarks-selection input:checked").count()) === 2,
    );
    check(
      "the weight inputs restore: mmlu-pro 2, gpqa-diamond 1, and only selected Benchmarks listed",
      (await page.locator("fieldset.weights-selection input[type=number]").count()) === 2 &&
        (await page
          .locator(`fieldset.weights-selection label.weight-option:has-text("${mmluPro.name}")`)
          .locator("input")
          .inputValue()) === "2" &&
        (await page
          .locator(`fieldset.weights-selection label.weight-option:has-text("${gpqa.name}")`)
          .locator("input")
          .inputValue()) === "1",
    );
    check(
      "the search and the License filter restore",
      (await page.locator('input[type="search"]').inputValue()) === "claude" &&
        (await page.locator('fieldset:has(legend:text-is("License")) input:checked').count()) === 1,
    );
    check(
      "the URL keeps the compared-Model parameter verbatim (reserved for the compare view)",
      queryString().includes("compare=claude-opus-4-6,claude-sonnet-4-6"),
      queryString(),
    );

    // Refreshing the shared URL keeps the view.
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const reloaded = await rowNames();
    check(
      "a refresh of the shared URL restores the same view again",
      JSON.stringify(reloaded) === JSON.stringify(expectedRows.map((model) => model.name)),
    );
  });

  await step("a shared URL with an explicit empty selection keeps meaning 'no Benchmark selected'", async () => {
    await page.goto(`${base}/?benchmarks=`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    check(
      "every aggregate renders n/a with (0/0) — never zero",
      (await page.locator("tbody tr td.average-cell").first().textContent())?.includes("n/a (0/0)") ===
        true,
    );
    const footer = (await page.locator(".table-note").textContent()) ?? "";
    check(
      "the footer counts 0 selected Benchmarks",
      footer.includes("Average over 0 selected Benchmarks"),
      footer.slice(0, 80),
    );
    check(
      "the weights fieldset states that no Benchmarks are selected",
      ((await page.locator(".weights-empty").textContent()) ?? "").includes(
        "No Benchmarks selected.",
      ),
    );
    check("the URL keeps the explicit empty selection", queryString() === "benchmarks=", queryString());
  });

  // --- Ticket 12: CSV and JSON export -----------------------------------

  await step("the export controls download the current view and the full dataset (ticket 12)", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // Three clearly labelled controls, each stating what it exports.
    const csvButton = page.locator(
      'button[aria-label="Export the current filtered and sorted view as CSV"]',
    );
    const jsonButton = page.locator(
      'button[aria-label="Export the current filtered and sorted view as JSON"]',
    );
    const datasetButton = page.locator(
      "button[aria-label=\"Export the full raw dataset as JSON, including all Scores and alternate Evaluation settings\"]",
    );
    check("the Export view (CSV) control is present with its aria-label", (await csvButton.count()) === 1);
    check("the Export view (JSON) control is present with its aria-label", (await jsonButton.count()) === 1);
    check(
      "the Export full dataset (JSON) control is present with its aria-label",
      (await datasetButton.count()) === 1,
    );
    check(
      "the controls' visible labels state what they export",
      (await csvButton.textContent()) === "Export view (CSV)" &&
        (await jsonButton.textContent()) === "Export view (JSON)" &&
        (await datasetButton.textContent()) === "Export full dataset (JSON)",
    );

    const today = new Date().toISOString().slice(0, 10);

    // Keyboard first: focus + Enter on the CSV control triggers the download
    // through a real Playwright download event.
    await csvButton.focus();
    const csvByKeyboard = page.waitForEvent("download", { timeout: 10_000 });
    await page.keyboard.press("Enter");
    const csvDownload = await csvByKeyboard;
    check(
      "the CSV control is keyboard-operable: Enter produces the download",
      (await csvDownload.suggestedFilename()) === `llm-bench-view-${today}.csv`,
      await csvDownload.suggestedFilename(),
    );

    const csv = readFileSync(await csvDownload.path(), "utf8");
    check("the CSV download is non-empty", csv.length > 0);
    const csvLines = csv.split("\r\n");
    const expectedHeader = [
      "Model id",
      "Model name",
      "Provider",
      "License",
      "License name",
      "Context window",
      "Release date",
      "Input price / 1M",
      "Output price / 1M",
      "Reference inference provider",
      "Average",
      "Coverage",
      ...selection.flatMap((id) => {
        const name = catalogue.find((benchmark) => benchmark.id === id)!.name;
        return [
          name,
          `${name} Source type`,
          `${name} source URL`,
          `${name} publishedDate`,
          `${name} retrievedDate`,
        ];
      }),
    ].join(",");
    check(
      "the CSV header derives from the active selection: Model fields, Average, Coverage, then per-Benchmark score + provenance columns",
      csvLines[0] === expectedHeader,
      (csvLines[0] ?? "").slice(0, 100),
    );
    check(
      "one row per Model plus header and trailing line break",
      csvLines.length === models.length + 2,
      `${csvLines.length} lines`,
    );
    check(
      "the CSV rows keep the ranked view order (GPT-6.2 Astra leads)",
      csvLines[1]!.startsWith("gpt-6-2-astra,GPT-6.2 Astra,"),
      (csvLines[1] ?? "").slice(0, 60),
    );
    const opusCsvLine = csvLines.find((line) => line.startsWith("claude-opus-4-6,"));
    check(
      "a real Model row carries its Primary scores with provenance (Opus 4.6: SWE-bench Verified 75.6, leaderboard, swebench.com) and its Average with Coverage (89.6475, (4/12)) — never its alternate settings (80.84, 99.25)",
      opusCsvLine !== undefined &&
        opusCsvLine.includes("75.6,leaderboard,https://www.swebench.com/") &&
        opusCsvLine.includes("89.6475,(4/12)") &&
        !opusCsvLine.includes("80.84") &&
        !opusCsvLine.includes("99.25"),
      opusCsvLine?.slice(0, 90) ?? "row missing",
    );

    // Now filter the view (search) and export again: the JSON must contain
    // exactly the filtered rows — the export reflects click-time state.
    await page.locator('input[type="search"]').fill("claude");
    const claudeModels = filterModels(models, { search: "claude" });
    check(
      "the table narrows to the Claude Models",
      (await page.locator("tbody tr").count()) === claudeModels.length,
      `${await page.locator("tbody tr").count()} rows vs ${claudeModels.length} expected`,
    );

    const jsonDownloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await jsonButton.click();
    const jsonDownload = await jsonDownloadPromise;
    check(
      "the view JSON download carries the dated filename",
      (await jsonDownload.suggestedFilename()) === `llm-bench-view-${today}.json`,
      await jsonDownload.suggestedFilename(),
    );
    const viewJson = JSON.parse(readFileSync(await jsonDownload.path(), "utf8")) as {
      metadata: {
        kind: string;
        aggregate: string;
        selectedBenchmarks: unknown[];
        filters: { search: string };
        rowCount: number;
      };
      rows: { model: { id: string }; scores: Record<string, { value: number } | null> }[];
    };
    check(
      "the view JSON describes itself: kind, aggregate, selection, and the active filters",
      viewJson.metadata.kind === "llm-bench-view" &&
        viewJson.metadata.aggregate === "Average" &&
        viewJson.metadata.selectedBenchmarks.length === selection.length &&
        viewJson.metadata.filters.search === "claude",
    );
    check(
      "the view JSON contains exactly the filtered rows (as a set — the order is the view's ranking)",
      viewJson.metadata.rowCount === claudeModels.length &&
        JSON.stringify([...viewJson.rows.map((row) => row.model.id)].sort()) ===
          JSON.stringify(claudeModels.map((model) => model.id).sort()),
    );
    const opusJsonRow = viewJson.rows.find((row) => row.model.id === "claude-opus-4-6");
    check(
      "the view JSON nests per-Benchmark scores with null for missing (Opus 4.6: SWE-bench Verified 75.6, MMLU-Pro null)",
      opusJsonRow?.scores["swebench-verified"]?.value === 75.6 &&
        opusJsonRow?.scores["mmlu-pro"] === null,
    );

    // Weights are click-time state too: with SWE-bench Verified weighted ×2
    // the CSV's aggregate column is labelled Weighted Average, and Opus 4.6's
    // aggregate is (91.31 + 99.79 + 91.89 + 2·75.6) / 5 = 86.838 (hand-computed,
    // Coverage still (4/12)).
    const swebench = catalogue.find((benchmark) => benchmark.id === "swebench-verified");
    if (swebench !== undefined) {
      const weightInput = page
        .locator(`fieldset.weights-selection label.weight-option:has-text("${swebench.name}")`)
        .locator("input");
      await weightInput.fill("2");

      const weightedCsvPromise = page.waitForEvent("download", { timeout: 10_000 });
      await csvButton.click();
      const weightedCsv = await weightedCsvPromise;
      const weightedCsvText = readFileSync(await weightedCsv.path(), "utf8");
      const weightedOpus = weightedCsvText
        .split("\r\n")
        .find((line) => line.startsWith("claude-opus-4-6,"));
      check(
        "a weight at click time switches the CSV aggregate column to Weighted Average and re-computes the value (86.838, (4/12))",
        weightedCsvText.split("\r\n")[0]!.includes(",Weighted Average,Coverage,") === true &&
          weightedOpus !== undefined &&
          weightedOpus.includes("86.838,(4/12)"),
        weightedOpus?.slice(0, 90) ?? "row missing",
      );
    }

    // The full-dataset export: the raw arrays, every Score included.
    const datasetDownloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await datasetButton.click();
    const datasetDownload = await datasetDownloadPromise;
    check(
      "the dataset download carries the dated filename",
      (await datasetDownload.suggestedFilename()) === `llm-bench-dataset-${today}.json`,
      await datasetDownload.suggestedFilename(),
    );
    const datasetJson = JSON.parse(readFileSync(await datasetDownload.path(), "utf8")) as {
      kind: string;
      models: unknown[];
      benchmarks: unknown[];
      scores: {
        modelId: string;
        benchmarkId: string;
        value: number;
        evaluationSetting: string;
        isPrimary: boolean;
      }[];
    };
    check(
      "the dataset export carries every raw Model, Benchmark, and Score",
      datasetJson.kind === "llm-bench-dataset" &&
        datasetJson.models.length === models.length &&
        datasetJson.benchmarks.length === catalogue.length &&
        datasetJson.scores.length === scores.length,
    );
    check(
      "the dataset export includes the non-Primary tau²-bench Telecom alternate (Opus 4.6, 99.25)",
      datasetJson.scores.some(
        (score) =>
          score.modelId === "claude-opus-4-6" &&
          score.benchmarkId === "tau2-bench" &&
          score.value === 99.25 &&
          score.evaluationSetting === "pass^1 (Telecom domain)" &&
          score.isPrimary === false,
      ),
    );
  });

  // --- Ticket 11: the price/performance scatter -------------------------

  // The pricing config the chart reads (the blended-price ratio is data).
  const pricingConfig = readJson<PricingConfig>("pricing-config.json");

  /** Every scatter point's aria-label, in plot (data-package) order. */
  const pointLabels = async (): Promise<string[]> => {
    const count = await page.locator(".scatter-point").count();
    const labels: string[] = [];
    for (let index = 0; index < count; index++) {
      labels.push((await page.locator(".scatter-point").nth(index).getAttribute("aria-label")) ?? "");
    }
    return labels;
  };

  /** The text contents of every element a selector matches. */
  const textsOf = async (selector: string): Promise<string[]> => {
    const count = await page.locator(selector).count();
    const texts: string[] = [];
    for (let index = 0; index < count; index++) {
      texts.push((await page.locator(selector).nth(index).textContent()) ?? "");
    }
    return texts;
  };

  await step("the Price vs performance section renders from real data", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    check(
      "the section heading renders below the table",
      (await page.locator("section.price-performance h2").textContent()) ===
        "Price vs performance",
    );

    // The plotted set, computed from the data through the scoring package:
    // the priced Models with an aggregate over the default core selection.
    const plottedIds = models
      .filter(
        (model) =>
          blendedPricePer1M(model, pricingConfig) !== null &&
          computeAverage(model.id, scores, { benchmarkIds: selection }).average !== null,
      )
      .map((model) => model.id);
    check(
      "18 of the 26 real Models are plotted (the priced, aggregated ones)",
      plottedIds.length === 18,
      `${plottedIds.length} plotted`,
    );

    const labels = await pointLabels();
    check(
      "one focusable point per plotted Model, in data order",
      labels.length === plottedIds.length &&
        labels.every((label, index) =>
          label.startsWith(
            `${models.find((model) => model.id === plottedIds[index])!.name}:`,
          ),
        ),
      `${labels.length} points; first: ${labels[0] ?? "none"}`,
    );

    // The null-priced Models are listed separately — the exact heading, with
    // their aggregates and Coverage — and never plotted.
    check(
      "the separate list carries the exact heading",
      (await page.locator(".self-hosted-list h3").textContent()) ===
        "Self-hosted / no public API rate",
    );
    const selfHostedText = (await page.locator(".self-hosted-list").textContent()) ?? "";
    const nullPriced = models.filter((model) => model.inputPricePer1M === null);
    check(
      "every null-priced Model is listed with its Average and Coverage",
      nullPriced.every((model) => {
        const result = computeAverage(model.id, scores, { benchmarkIds: selection });
        const expected =
          `${model.name} — Average ` +
          `${Number((result.average ?? 0).toFixed(1)).toString()} ` +
          `(${result.coverage}/${result.selected})`;
        return selfHostedText.includes(expected);
      }),
      selfHostedText.slice(0, 120),
    );
    check(
      "no null-priced Model is plotted",
      labels.every(
        (label) =>
          !nullPriced.some((model) => label.startsWith(`${model.name}:`)),
      ),
    );

    // The default basis is blended, with the methodology read from the
    // pricing-config data.
    check(
      "the default price basis is blended",
      (await page.locator("fieldset.price-basis input:checked").getAttribute("value")) ===
        "blended",
    );
    const basisText = (await page.locator("fieldset.price-basis").textContent()) ?? "";
    check(
      "the blended option shows the formula from the pricing-config data",
      basisText.includes("(3 × Input price + 1 × Output price) / 4"),
      basisText.slice(0, 100),
    );
  });

  await step("the price-basis selector switches the price axis between input, output, and blended", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // GPT-6.2 Astra (8 in / 40 out / 16 blended at 3:1) has a distinct price
    // on every basis, so its point label tracks the selector.
    const astraLabel = async (): Promise<string> =>
      (await pointLabels()).find((label) => label.startsWith("GPT-6.2 Astra:")) ?? "";
    const axisTitles = async (): Promise<string[]> => textsOf(".scatter-svg .axis-title");
    const tickTexts = async (): Promise<string[]> => textsOf(".scatter-svg .axis-tick");

    // Blended (default): axis max 20 (nice step over the max 16).
    check(
      "blended: the x axis reads Blended price / 1M ($) and the point shows $16.00",
      (await axisTitles()).includes("Blended price / 1M ($)") &&
        (await astraLabel()).includes("Blended price / 1M $16.00"),
      await astraLabel(),
    );
    check(
      "blended: the price axis tops out at the nice maximum 20",
      (await tickTexts()).includes("20") &&
        !(await tickTexts()).includes("8") &&
        !(await tickTexts()).includes("40"),
      (await tickTexts()).join(","),
    );

    await page.locator('fieldset.price-basis input[value="input"]').click();
    check(
      "the input basis is checked after the click",
      (await page.locator("fieldset.price-basis input:checked").getAttribute("value")) ===
        "input",
    );
    check(
      "input: the x axis reads Input price / 1M ($) and the point shows $8.00",
      (await axisTitles()).includes("Input price / 1M ($)") &&
        (await astraLabel()).includes("Input price / 1M $8.00"),
      await astraLabel(),
    );
    check(
      "input: the price axis tops out at 8 (the max input price)",
      (await tickTexts()).includes("8") && !(await tickTexts()).includes("40"),
      (await tickTexts()).join(","),
    );

    await page.locator('fieldset.price-basis input[value="output"]').click();
    check(
      "output: the x axis reads Output price / 1M ($) and the point shows $40.00",
      (await axisTitles()).includes("Output price / 1M ($)") &&
        (await astraLabel()).includes("Output price / 1M $40.00"),
      await astraLabel(),
    );
    check(
      "output: the price axis tops out at 40 (the max output price)",
      (await tickTexts()).includes("40"),
      (await tickTexts()).join(","),
    );

    // Back to blended: the switch is instant and reversible.
    await page.locator('fieldset.price-basis input[value="blended"]').click();
    check(
      "back on blended: the point shows $16.00 again",
      (await astraLabel()).includes("Blended price / 1M $16.00"),
      await astraLabel(),
    );
  });

  await step("keyboard focus reaches the scatter points and shows the aggregate and Coverage", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // The first point in plot order is Kimi K3.1 Pro (Moonshot AI): blended
    // (3·2 + 10)/4 = 4, Average 94.2 over its single core Benchmark, so
    // Coverage (1/12) — hand-computed from models.json + scores.json.
    const firstPoint = page.locator(".scatter-point").first();
    await firstPoint.focus();
    check(
      "a scatter point can take keyboard focus",
      (await page.locator(".scatter-point:focus").count()) === 1,
    );

    const firstLabel = (await firstPoint.getAttribute("aria-label")) ?? "";
    check(
      "the focused point's label reads Model, aggregate, Coverage, price, and practical facts",
      firstLabel ===
        "Kimi K3.1 Pro: Average 94.2, Coverage (1/12), Blended price / 1M $4.00, Provider Moonshot AI",
      firstLabel,
    );

    // The focus indicator paints: an outline on the point group plus a ring
    // on its circle, in the active theme.
    const focusPaint = await page.evaluate<{
      outlineStyle: string;
      outlineWidth: string;
      strokeWidth: string;
    } | null>(
      "(() => { const g = document.querySelector('.scatter-point:focus');" +
        " if (g === null) return null; const s = getComputedStyle(g);" +
        " const c = getComputedStyle(g.querySelector('circle'));" +
        " return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, strokeWidth: c.strokeWidth }; })()",
    );
    check(
      "the focused point paints a visible focus indicator (outline + ring)",
      focusPaint !== null &&
        focusPaint.outlineStyle !== "none" &&
        parseFloat(focusPaint.outlineWidth) >= 2 &&
        parseFloat(focusPaint.strokeWidth) >= 2,
      JSON.stringify(focusPaint),
    );

    // The tooltip appears on focus and carries the same reading — the
    // Coverage included.
    const tooltip = (await page.locator(".point-tooltip").textContent()) ?? "";
    check(
      "focus shows the point's tooltip: name, Average, Coverage, price",
      tooltip.includes("Kimi K3.1 Pro") &&
        tooltip.includes("94.2") &&
        tooltip.includes("(1/12)") &&
        tooltip.includes("$4.00"),
      tooltip,
    );

    // Tab walks to the next point and the tooltip follows it.
    await page.keyboard.press("Tab");
    check(
      "Tab moves focus to the next point (Claude Opus 4.5)",
      (await page.locator(".scatter-point:focus").count()) === 1 &&
        ((await page.locator(".scatter-point:focus").getAttribute("aria-label")) ?? "").startsWith(
          "Claude Opus 4.5:",
        ),
      (await page.locator(".scatter-point:focus").getAttribute("aria-label")) ?? "nothing",
    );
    const nextTooltip = (await page.locator(".point-tooltip").textContent()) ?? "";
    check(
      "the tooltip follows to the next point",
      nextTooltip.includes("Claude Opus 4.5") && nextTooltip.includes("(4/12)"),
      nextTooltip,
    );

    // Hover shows the same tooltip as focus (mouse parity).
    await page.locator(".scatter-point").nth(2).hover();
    const hoverTooltip = (await page.locator(".point-tooltip").textContent()) ?? "";
    check(
      "hover shows the same tooltip content",
      hoverTooltip.includes("Claude Sonnet 4.5"),
      hoverTooltip,
    );
  });

  await step("the scatter follows the active view — weights switch the aggregate, the selection switches Coverage", async () => {
    // A weight makes every point read the Weighted Average — the same active
    // aggregate as the table. Hand-computed (ticket 06): with SWE-bench
    // Verified ×2, Claude Opus 4.6 reads 86.8 with Coverage (4/12).
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const swebench = catalogue.find((benchmark) => benchmark.id === "swebench-verified");
    if (swebench === undefined) {
      check("data has SWE-bench Verified", false);
      return;
    }
    const weightInput = page
      .locator(`fieldset.weights-selection label.weight-option:has-text("${swebench.name}")`)
      .locator("input");
    await weightInput.click();
    await weightInput.fill("2");

    check(
      "the aggregate axis switches to Weighted Average",
      (await textsOf(".scatter-svg .axis-title")).includes("Weighted Average"),
    );
    const opusLabel =
      (await pointLabels()).find((label) => label.startsWith("Claude Opus 4.6:")) ?? "";
    check(
      "the points re-read the Weighted Average (Opus 4.6: 86.8, Coverage (4/12))",
      opusLabel.includes("Weighted Average 86.8, Coverage (4/12)"),
      opusLabel,
    );
    check(
      "the self-hosted list switches to the Weighted Average too",
      ((await page.locator(".self-hosted-list").textContent()) ?? "").includes(
        "DeepSeek-V4-Pro — Weighted Average",
      ),
    );

    // Narrowing the selection re-reads Coverage against it, and priced
    // Models that lose their aggregate leave the plot — named in a note,
    // never silently dropped. Unchecking GPQA Diamond (11 selected) drops
    // the six gpqa-only priced Models from the 18-point plot.
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const gpqaIndex = catalogue.findIndex((benchmark) => benchmark.id === "gpqa-diamond");
    await page
      .locator("fieldset.benchmarks-selection label")
      .nth(gpqaIndex)
      .locator("input")
      .click();

    const narrowed = selection.filter((id) => id !== "gpqa-diamond");
    const stillPlotted = models.filter(
      (model) =>
        blendedPricePer1M(model, pricingConfig) !== null &&
        computeAverage(model.id, scores, { benchmarkIds: narrowed }).average !== null,
    );
    const labels = await pointLabels();
    check(
      "the plot narrows to the Models with an aggregate over the narrower selection",
      labels.length === stillPlotted.length,
      `${labels.length} points vs ${stillPlotted.length} expected`,
    );
    const note = (await page.locator(".price-performance .chart-note").textContent()) ?? "";
    check(
      "priced Models without an aggregate are named in a note, not silently dropped",
      note.includes("Not plotted") && note.includes("Kimi K3.1 Pro") && note.includes("GPT-6.2 Sol"),
      note.slice(0, 120),
    );
    const opusNarrowed =
      (await pointLabels()).find((label) => label.startsWith("Claude Opus 4.6:")) ?? "";
    check(
      "Coverage reads against the narrowed selection ((3/11) for Opus 4.6)",
      opusNarrowed.includes("Coverage (3/11)"),
      opusNarrowed,
    );
    check(
      "the self-hosted list still shows all 8 null-priced Models, Coverage against 11",
      (await page.locator(".self-hosted-list li").count()) === 8 &&
        ((await page.locator(".self-hosted-list").textContent()) ?? "").includes("(3/11)"),
    );
  });

  // --- Ticket 09: Model detail pages -----------------------------------

  // A real null-priced Model with both scored and unscored Benchmarks, so
  // one page exercises prices, the chart, and the Score sections.
  const maverick = models.find((model) => model.id === "llama-4-maverick");
  if (
    maverick === undefined ||
    maverick.inputPricePer1M !== null ||
    scores.filter((score) => score.isPrimary && score.modelId === maverick.id).length === 0
  ) {
    check("data has the null-priced llama-4-maverick with at least one Primary score", false);
  } else {
    await step("direct navigation renders a Model page from data", async () => {
      await page.goto(`${base}/models/${maverick.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      check("h1 is the Model name", (await page.locator("h1").textContent()) === maverick.name);
      check(
        "document title names the Model",
        (await page.title()) === `${maverick.name} — LLM Bench`,
        await page.title(),
      );

      const body = await bodyText();
      // The header date is the data currency: the latest of the Model's
      // lastUpdated and its Scores' retrievedDate values.
      check(
        "the header shows the data currency date",
        body.includes(`Data current as of ${modelDataCurrency(maverick, scores)}`),
        `expected ${modelDataCurrency(maverick, scores)}`,
      );

      // The facts, with the glossary vocabulary as labels.
      check("Provider renders", body.includes(maverick.provider));
      check("License and License name render", body.includes(maverick.license) && (maverick.licenseName === undefined || body.includes(maverick.licenseName)));
      check(
        "Context window renders with thousands separators",
        body.includes(maverick.contextWindow.toLocaleString("en-US")),
      );
      check("Release date renders", body.includes(maverick.releaseDate));
      check(
        "null prices read exactly \"self-hosted / no public API rate\" — never zero",
        body.includes("self-hosted / no public API rate") &&
          !body.includes("$0.00") &&
          (await page.locator(".model-facts .missing").count()) === 2,
      );
      check(
        "the Model source link points at its source and shows its host",
        (await page.locator(".model-facts a").getAttribute("href")) === maverick.sourceUrl &&
          body.includes(new URL(maverick.sourceUrl).hostname),
      );
      check(
        "notes render",
        maverick.notes !== undefined && body.includes(maverick.notes.slice(0, 80)),
      );
      check(
        "back-to-leaderboard link is first and points at /",
        (await page.locator(".back-link a").getAttribute("href")) === "/" &&
          (await page.locator(".back-link a").textContent()) === "Back to leaderboard",
      );
    });

    await step("refresh on a Model route keeps working", async () => {
      await page.goto(`${base}/models/${maverick.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      await page.reload({ waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check("h1 still renders after refresh", (await page.locator("h1").textContent()) === maverick.name);
      check(
        "facts still render after refresh",
        (await bodyText()).includes(maverick.provider),
      );
    });

    await step("the chart compares the Model against the Benchmark leaders with n/a for gaps", async () => {
      await page.goto(`${base}/models/${maverick.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      // One chart row per Benchmark, in catalogue order (like the
      // leaderboard's columns), each carrying the Model's Primary score
      // and the best Primary score across all Models — computed here from
      // the data package via the scoring package.
      const bestByBenchmark = bestValueByBenchmark(scores);
      const expectedLabels = catalogue.map((benchmark) => {
        const primary = primaryScoreFor(maverick.id, benchmark.id, scores);
        const bestValue = bestByBenchmark.get(benchmark.id);
        return (
          `${benchmark.name}: ${maverick.name} ${primary === undefined ? "n/a" : primary.value}; ` +
          `Best across Models ${bestValue === undefined ? "n/a" : bestValue}`
        );
      });

      const rows = page.locator("svg g[role=img]");
      const rowCount = await rows.count();
      check("one chart row per Benchmark, in catalogue order", rowCount === catalogue.length, `${rowCount} rows`);

      let allRowsMatch = true;
      for (let index = 0; index < Math.min(rowCount, expectedLabels.length); index++) {
        const label = await rows.nth(index).getAttribute("aria-label");
        if (label !== expectedLabels[index]) {
          allRowsMatch = false;
          check(
            `chart row ${index} reads the Benchmark, the Model, and the leader`,
            false,
            `${label ?? "null"} vs ${expectedLabels[index]}`,
          );
        }
      }
      check("every chart row reads the Benchmark, the Model, and the leader", allRowsMatch);

      const scored = catalogue.filter((benchmark) =>
        scores.some((score) => score.isPrimary && score.modelId === maverick.id && score.benchmarkId === benchmark.id),
      );
      const unscored = catalogue.filter((benchmark) => !scored.includes(benchmark));
      const chartText = (await page.locator("svg").textContent()) ?? "";
      check(
        "a missing Primary renders n/a on the chart — never a zero bar",
        unscored.length > 0 &&
          unscored.every(
            (benchmark) =>
              chartText.includes(benchmark.name) &&
              expectedLabels[catalogue.indexOf(benchmark)]!.includes(" n/a;"),
          ) &&
          (await page.locator("svg .chart-value.missing").count()) >= unscored.length,
        `${unscored.length} unscored Benchmarks`,
      );

      // The legend names both series: the Model and the best across Models.
      const legendText = (await page.locator(".chart-legend").textContent()) ?? "";
      check(
        "the legend names the Model and the best-across-Models series",
        legendText.includes(maverick.name) && legendText.includes("Best across Models"),
        legendText,
      );
    });

    await step("every Benchmark gets a Score section, n/a when unscored", async () => {
      await page.goto(`${base}/models/${maverick.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      const sections = page.locator('section:has(> h2 a[href^="/benchmarks/"])');
      const sectionCount = await sections.count();
      check("one Score section per Benchmark", sectionCount === catalogue.length, `${sectionCount} sections`);

      // Each section's heading links to the Benchmark's page, in catalogue order.
      let orderMatches = true;
      for (let index = 0; index < Math.min(sectionCount, catalogue.length); index++) {
        const href = await sections.nth(index).locator("h2 a").getAttribute("href");
        if (href !== `/benchmarks/${catalogue[index]!.id}`) {
          orderMatches = false;
          check(`section ${index} links to its Benchmark`, false, href ?? "null");
        }
      }
      check("sections render in catalogue order, each linking to its Benchmark", orderMatches);

      // A scored pair shows the Primary score and its provenance; an
      // unscored pair shows the n/a sentence — never a zero.
      const scoredBenchmark = catalogue.find((benchmark) =>
        scores.some((score) => score.isPrimary && score.modelId === maverick.id && score.benchmarkId === benchmark.id),
      );
      const unscoredBenchmark = catalogue.find((benchmark) =>
        !scores.some((score) => score.modelId === maverick.id && score.benchmarkId === benchmark.id),
      );
      if (scoredBenchmark !== undefined) {
        const primary = primaryScoreFor(maverick.id, scoredBenchmark.id, scores)!;
        const sectionText =
          (await page.locator(`section:has(h2 a[href="/benchmarks/${scoredBenchmark.id}"])`).textContent()) ?? "";
        check(
          "a scored pair shows the Primary score with full provenance",
          sectionText.includes("Primary score") &&
            sectionText.includes(String(primary.value)) &&
            sectionText.includes(primary.evaluationSetting) &&
            sectionText.includes(primary.sourceType) &&
            sectionText.includes(primary.publishedDate) &&
            sectionText.includes(primary.retrievedDate),
          sectionText.slice(0, 90),
        );
      }
      if (unscoredBenchmark !== undefined) {
        const sectionText =
          (await page.locator(`section:has(h2 a[href="/benchmarks/${unscoredBenchmark.id}"])`).textContent()) ?? "";
        check(
          "an unscored pair shows the n/a sentence",
          sectionText.includes("n/a") && sectionText.includes("no Scores have been published for"),
          sectionText.slice(0, 90),
        );
      }
    });

    await step("keyboard navigation reaches the Model page content", async () => {
      await page.goto(`${base}/models/${maverick.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      // Ticket 13 site chrome: the skip link is the first tab stop, the
      // theme toggle second, then the page content begins with the back link.
      await page.keyboard.press("Tab");
      const firstTabStop = await page.locator(":focus").first().textContent();
      check(
        "first tab stop is the skip-to-content link",
        firstTabStop === "Skip to content",
        firstTabStop ?? "nothing focused",
      );

      await page.keyboard.press("Tab");
      check(
        "second tab stop is the theme toggle",
        (await page.locator("button.theme-toggle:focus").count()) === 1,
      );

      await page.keyboard.press("Tab");
      const thirdTabStop = await page.locator(":focus").first().textContent();
      check(
        "the tab order reaches the back-to-leaderboard link next",
        thirdTabStop === "Back to leaderboard",
        thirdTabStop ?? "nothing focused",
      );

      // The Benchmark-name links inside the Score sections are operable
      // from the keyboard too (every control on the page is a real link).
      await page.locator("section h2 a").first().focus();
      await page.keyboard.press("Enter");
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(
        "Enter on a Benchmark-name link opens the Benchmark page",
        pathname() === `/benchmarks/${catalogue[0]!.id}`,
        page.url(),
      );
    });
  }

  await step("a third-party rate names its Reference inference provider", async () => {
    // Real Models whose rate comes from a third party (ticket 04's data):
    // the page must name whose price is being read.
    const thirdParty = models.filter((model) => model.referenceInferenceProvider !== null);
    check(
      "data has Models with a Reference inference provider (kimi-k2-5, minimax-m2-5)",
      thirdParty.map((model) => model.id).join(",") === "kimi-k2-5,minimax-m2-5",
      thirdParty.map((model) => model.id).join(","),
    );

    for (const model of thirdParty) {
      await page.goto(`${base}/models/${model.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      const body = await bodyText();
      check(
        `${model.id} names its Reference inference provider`,
        body.includes("Reference inference provider") &&
          body.includes(`rate from ${model.referenceInferenceProvider}`),
        `expected "rate from ${model.referenceInferenceProvider}"`,
      );
    }

    // A first-party rate names no third party.
    const firstParty = models.find(
      (model) => model.referenceInferenceProvider === null && model.inputPricePer1M !== null,
    );
    if (firstParty !== undefined) {
      await page.goto(`${base}/models/${firstParty.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(
        "a first-party rate names no Reference inference provider",
        !(await bodyText()).includes("Reference inference provider"),
      );
    }
  });

  await step("alternate Evaluation settings render on the Model page", async () => {
    // A real Model with a pair recorded under more than one Evaluation
    // setting, found from the data (the leaderboard's Score details panel
    // shows the same pair).
    const pairWithAlternates = scores.find((score) =>
      scores.some(
        (other) =>
          other.modelId === score.modelId &&
          other.benchmarkId === score.benchmarkId &&
          other.evaluationSetting !== score.evaluationSetting,
      ),
    );
    if (pairWithAlternates === undefined) {
      check("data has a pair with alternate Evaluation settings", false);
      return;
    }
    const model = models.find((candidate) => candidate.id === pairWithAlternates.modelId)!;
    const benchmark = catalogue.find((candidate) => candidate.id === pairWithAlternates.benchmarkId)!;
    const pair = scores.filter(
      (score) => score.modelId === model.id && score.benchmarkId === benchmark.id,
    );
    const primary = pair.find((score) => score.isPrimary)!;
    const alternates = pair.filter((score) => !score.isPrimary);

    await page.goto(`${base}/models/${model.id}`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    const sectionText =
      (await page.locator(`section:has(h2 a[href="/benchmarks/${benchmark.id}"])`).textContent()) ?? "";

    check(
      "the pair's section shows the Primary score and every alternate Evaluation setting",
      sectionText.includes("Primary score") &&
        sectionText.includes(String(primary.value)) &&
        alternates.every(
          (score) =>
            sectionText.includes(String(score.value)) &&
            sectionText.includes(score.evaluationSetting),
        ),
    );
    check(
      "the exclusion note renders: alternates never feed the Average or charts",
      sectionText.includes("Excluded from the Average"),
    );
    check(
      "the verified-semantics note renders",
      sectionText.includes(
        "Verified means the data owner checked the value and Evaluation setting against the linked Source URL, not an independent reproduction",
      ),
    );
  });

  await step("every Model in the data package has a directly addressable page", async () => {
    for (const model of models) {
      await page.goto(`${base}/models/${model.id}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      const h1 = await page.locator("h1").textContent();
      check(`h1 renders for ${model.id}`, h1 === model.name, h1 ?? "null");
    }
  });

  await step("unknown Model id gets a proper not-found view", async () => {
    await page.goto(`${base}/models/definitely-not-a-model`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    check("h1 is Model not found", (await page.locator("h1").textContent()) === "Model not found");
    check("the unknown id is shown", (await bodyText()).includes("definitely-not-a-model"));
  });

  await step("the leaderboard links Model names to their pages", async () => {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible" });

    // Every row's Model name is a link to that Model's page.
    const linkCount = await page.locator('tbody th a[href^="/models/"]').count();
    check("every leaderboard row links its Model name", linkCount === models.length, `${linkCount} links`);

    // Client-side navigation via a real link click.
    await page.locator(`tbody th a[href="/models/${maverick?.id ?? models[0]!.id}"]`).first().click();
    await page.locator("h1").first().waitFor({ state: "visible" });
    check(
      "click navigates to the Model route",
      pathname() === `/models/${maverick?.id ?? models[0]!.id}`,
      page.url(),
    );
    check("focus moves to the page content", (await page.locator("main:focus").count()) === 1);
  });

  // --- Ticket 10: the compare view ---------------------------------------

  /** The trimmed text of every element a locator matches, in order. */
  const allTexts = async (locator: LocatorLike): Promise<string[]> => {
    const count = await locator.count();
    const texts: string[] = [];
    for (let index = 0; index < count; index++) {
      texts.push(((await locator.nth(index).textContent()) ?? "").trim());
    }
    return texts;
  };

  /** The trimmed text of one table row's cells (th and td), left to right. */
  const rowCellTexts = async (row: LocatorLike): Promise<string[]> =>
    allTexts(row.locator("th, td"));

  /** Waits until the page's single h1 reads exactly `text`. */
  const waitForH1 = (text: string): Promise<void> =>
    page.waitForFunction(
      "(() => { const h1 = document.querySelector('h1');" +
        ` return h1 !== null && h1.textContent === ${JSON.stringify(text)}; })()`,
    );

  // The compared pair, data-driven: the first two Models in data order that
  // each have at least two Primary scores on the default selection and share
  // a scored Benchmark — a real comparison of finalists, with real values
  // and real gaps on both charts.
  const scoredSelectionIds = (modelId: string): string[] =>
    selectedBenchmarks(catalogue, selection)
      .filter((benchmark) => primaryScoreFor(modelId, benchmark.id, scores) !== undefined)
      .map((benchmark) => benchmark.id);
  const comparedPair = (() => {
    const eligible = models.filter((model) => scoredSelectionIds(model.id).length >= 2);
    for (let left = 0; left < eligible.length; left++) {
      for (let right = left + 1; right < eligible.length; right++) {
        const leftIds = scoredSelectionIds(eligible[left]!.id);
        if (scoredSelectionIds(eligible[right]!.id).some((id) => leftIds.includes(id))) {
          return [eligible[left]!, eligible[right]!] as const;
        }
      }
    }
    return null;
  })();

  if (comparedPair === null) {
    check("data has two Models sharing a scored Benchmark for the compare view", false);
  } else {
    const comparedModels = [...comparedPair];
    const comparedIds = comparedModels.map((model) => model.id);
    const selectionBenchmarks = selectedBenchmarks(catalogue, selection);
    const radar = selectRadarBenchmarks(selectionBenchmarks, comparedIds, scores);
    const radarNames = radar.benchmarkIds.map(
      (id) => selectionBenchmarks.find((benchmark) => benchmark.id === id)!.name,
    );

    /** One Model's Compare checkbox on the leaderboard. */
    const compareCheckbox = (model: Model): LocatorLike =>
      page.locator(`tbody input[type="checkbox"][aria-label="Compare ${model.name}"]`);

    /** How many Compare checkboxes are checked on the leaderboard. */
    const checkedCompareCount = (): Promise<number> =>
      page.locator('tbody input[type="checkbox"]:checked').count();

    await step("the Compare checkboxes open the side-by-side comparison of 2 to 4 Models", async () => {
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      check(
        "the Compare selected control starts disabled at 0 Models",
        ((await page.locator("button.compare-link[disabled]").textContent()) ?? "").trim() ===
          "Compare selected (0)",
      );

      await compareCheckbox(comparedModels[0]!).click();
      await compareCheckbox(comparedModels[1]!).click();
      check(
        "the leaderboard URL gains the compare parameter with both Model ids",
        queryString().includes(`compare=${comparedIds.join(",")}`),
        queryString(),
      );
      check(
        "the enabling control is a link reading Compare selected (2)",
        ((await page.locator("a.compare-link").textContent()) ?? "").trim() ===
          "Compare selected (2)",
      );
      const href = (await page.locator("a.compare-link").getAttribute("href")) ?? "";
      check(
        "the link carries the whole shared URL state (selection + compared Models)",
        href.startsWith("/compare?") &&
          href.includes("benchmarks=") &&
          href.includes(`compare=${comparedIds.join(",")}`),
        href,
      );

      await page.locator("a.compare-link").click();
      await waitForH1("Compare Models");
      check("the click opens the compare route", pathname() === "/compare", page.url());
      check(
        "the document title names the compare view",
        (await page.title()) === "Compare Models — LLM Bench",
      );
      check("focus moves to the page content", (await page.locator("main:focus").count()) === 1);
      check(
        "the intro counts the compared Models and the selected Benchmarks",
        (await bodyText()).includes(
          `2 Models side by side across the ${selectionBenchmarks.length} selected Benchmarks`,
        ),
      );

      // The side-by-side table: one column per compared Model (linked to its
      // page) above the fixed facts, then one row per selected Benchmark.
      const headerTexts = await allTexts(page.locator("table thead th"));
      check(
        "the compared Models head the table, each linked to its page",
        JSON.stringify(headerTexts) ===
          JSON.stringify(["Model", comparedModels[0]!.name, comparedModels[1]!.name]) &&
          (await page.locator(`table thead a[href="/models/${comparedIds[0]}"]`).count()) === 1 &&
          (await page.locator(`table thead a[href="/models/${comparedIds[1]}"]`).count()) === 1,
        headerTexts.join(" | "),
      );

      const rowCount = await page.locator("table tbody tr").count();
      check(
        "the table renders the fixed Model facts plus one row per selected Benchmark",
        rowCount === 6 + selectionBenchmarks.length,
        `${rowCount} rows`,
      );

      // The aggregate row: the active aggregate (a plain Average here — the
      // URL carries no weights) with its Coverage, as the leaderboard shows it.
      const aggregateRow = await rowCellTexts(page.locator("table tbody tr").nth(5));
      const expectedAggregate = comparedIds.map((modelId) => {
        const result = computeAverage(modelId, scores, { benchmarkIds: selection });
        return `${Number(result.average!.toFixed(1))} (${result.coverage}/${result.selected})`;
      });
      check(
        "the aggregate row shows each Model's Average with its Coverage",
        aggregateRow[0] === "Average" &&
          aggregateRow[1] === expectedAggregate[0] &&
          aggregateRow[2] === expectedAggregate[1],
        aggregateRow.join(" | "),
      );

      // One row per selected Benchmark in catalogue order: each compared
      // Model's Primary score, "n/a" for a gap — never zero.
      const benchmarkRows: string[][] = [];
      for (let index = 6; index < rowCount; index++) {
        benchmarkRows.push(await rowCellTexts(page.locator("table tbody tr").nth(index)));
      }
      const expectedRows = selectionBenchmarks.map((benchmark) => [
        benchmark.name,
        ...comparedIds.map((modelId) => {
          const score = primaryScoreFor(modelId, benchmark.id, scores);
          return score === undefined ? "n/a" : String(score.value);
        }),
      ]);
      check(
        "every selected Benchmark has its row — each Model's Primary score or n/a, never zero",
        JSON.stringify(benchmarkRows) === JSON.stringify(expectedRows),
        benchmarkRows.slice(0, 2).map((row) => row.join(" | ")).join("  //  "),
      );
    });

    await step("the radar chart caps at 8 axes and names the deprioritized Benchmarks", async () => {
      // Still on /compare, with the default selection of 12 Benchmarks —
      // more than the radar's cap.
      const axisNames = await allTexts(page.locator(".radar-chart-svg text.chart-label"));
      check(
        `the radar plots at most ${RADAR_AXIS_CAP} axes (here ${radar.benchmarkIds.length} of the ${selectionBenchmarks.length} selected)`,
        axisNames.length === radar.benchmarkIds.length &&
          radar.benchmarkIds.length <= RADAR_AXIS_CAP &&
          selectionBenchmarks.length > RADAR_AXIS_CAP,
        axisNames.join(" | "),
      );
      check(
        "the axes are the Benchmarks with the most Primary scores across the compared Models",
        JSON.stringify(axisNames) === JSON.stringify(radarNames),
        axisNames.join(" | "),
      );

      const body = await bodyText();
      check(
        "the cap note states the cap and names every deprioritized Benchmark",
        body.includes(`capped at ${RADAR_AXIS_CAP} axes`) &&
          body.includes("Not on the radar:") &&
          radar.deprioritizedBenchmarkIds
            .map((id) => selectionBenchmarks.find((benchmark) => benchmark.id === id)!.name)
            .every((name) => body.includes(name)),
      );

      // A Model missing a Benchmark reads "n/a" on its axis — a dashed gap,
      // never a plotted zero at the centre.
      const expectedMissing = radar.benchmarkIds.reduce(
        (total, benchmarkId) =>
          total +
          comparedIds.filter(
            (modelId) => primaryScoreFor(modelId, benchmarkId, scores) === undefined,
          ).length,
        0,
      );
      const missingLabels = await page.locator(".radar-chart-svg .chart-value.missing").count();
      check(
        "every gap on the radar reads n/a — never a plotted zero",
        missingLabels === expectedMissing && expectedMissing > 0,
        `${missingLabels} n/a labels vs ${expectedMissing} expected`,
      );
    });

    await step("the bar chart shows every selected Benchmark, n/a for gaps", async () => {
      const rowGroups = page.locator('.bar-chart-svg g[role="img"]');
      check(
        "the bar chart renders one row per selected Benchmark — not the radar's capped set",
        (await rowGroups.count()) === selectionBenchmarks.length &&
          selectionBenchmarks.length > RADAR_AXIS_CAP,
        `${await rowGroups.count()} rows`,
      );

      // Each row is itself a labelled group reading every Model's value —
      // the chart's values are perceivable without sight.
      const readings: string[] = [];
      for (let index = 0; index < selectionBenchmarks.length; index++) {
        readings.push((await rowGroups.nth(index).getAttribute("aria-label")) ?? "");
      }
      const expectedReadings = selectionBenchmarks.map(
        (benchmark) =>
          `${benchmark.name}: ${comparedModels
            .map((model) => {
              const score = primaryScoreFor(model.id, benchmark.id, scores);
              return `${model.name} ${score === undefined ? "n/a" : score.value}`;
            })
            .join("; ")}`,
      );
      check(
        "every bar row reads each Model's Primary score or n/a",
        JSON.stringify(readings) === JSON.stringify(expectedReadings),
        readings[0] ?? "",
      );

      const expectedMissing = selectionBenchmarks.reduce(
        (total, benchmark) =>
          total +
          comparedIds.filter((modelId) => primaryScoreFor(modelId, benchmark.id, scores) === undefined)
            .length,
        0,
      );
      const missingLabels = await page.locator(".bar-chart-svg .chart-value.missing").count();
      check(
        "every gap on the bar chart reads n/a — never a zero-length bar",
        missingLabels === expectedMissing && expectedMissing > 0,
        `${missingLabels} n/a labels vs ${expectedMissing} expected`,
      );
    });

    await step("a shared comparison URL survives refresh", async () => {
      // The URL the Compare selected link produced is still current.
      const shared = page.url();
      check(
        "the compared Models are encoded in the URL's compare parameter",
        new URL(shared).searchParams.get("compare") === comparedIds.join(","),
        shared,
      );

      await page.reload({ waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(
        "the compare view still renders after the refresh",
        (await page.locator("h1").textContent()) === "Compare Models",
      );
      check("the URL is unchanged by the refresh", page.url() === shared, page.url());
      check(
        "the compared Models still head the table",
        JSON.stringify(await allTexts(page.locator("table thead th"))) ===
          JSON.stringify(["Model", comparedModels[0]!.name, comparedModels[1]!.name]),
      );
      check(
        "the radar still caps at its axes after the refresh",
        (await page.locator(".radar-chart-svg text.chart-label").count()) ===
          radar.benchmarkIds.length,
      );

      // The browser's back button returns to the leaderboard with the whole
      // view intact — including the Compare checkboxes.
      await page.goBack();
      await waitForH1("LLM Bench");
      check(
        "back returns to the leaderboard with the compared Models still checked",
        (await checkedCompareCount()) === 2 &&
          ((await page.locator("a.compare-link").textContent()) ?? "").trim() ===
            "Compare selected (2)",
      );
    });

    await step("guard rails: fewer than 2, more than 4, and unknown ids get friendly messages", async () => {
      // No compare parameter: the page explains the flow, not an empty table.
      await page.goto(`${base}/compare`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(
        "with no compared Models the page explains the 2-to-4 rule",
        (await bodyText()).includes("A comparison shows 2 to 4 Models side by side"),
      );

      // Five compared ids: over the cap.
      const five = models.slice(0, 5).map((model) => model.id);
      await page.goto(`${base}/compare?compare=${five.join(",")}`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });
      check(
        "with 5 compared Models the page asks to uncheck some",
        (await bodyText()).includes("This link compares 5 Models"),
      );

      // A stale shared link: an unknown id among two known ones is dropped
      // with a note, and the known Models still compare.
      await page.goto(`${base}/compare?compare=${[...comparedIds, "definitely-not-a-model"].join(",")}`, {
        waitUntil: "load",
      });
      await page.locator("h1").first().waitFor({ state: "visible" });
      const stale = await bodyText();
      check(
        "an unknown compared id is dropped with a note; the known Models still compare",
        stale.includes("No Model with id definitely-not-a-model exists in the data package") &&
          stale.includes("it was left out of this comparison") &&
          stale.includes(comparedModels[0]!.name) &&
          stale.includes(comparedModels[1]!.name),
      );
    });

    await step("the compare flow is keyboard-operable, and the leaderboard caps it at 4 Models", async () => {
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ state: "visible" });

      // Space on a row's Compare checkbox toggles it — no mouse needed.
      await compareCheckbox(comparedModels[0]!).focus();
      await page.keyboard.press("Space");
      check("Space checks the first Compare checkbox", (await checkedCompareCount()) === 1);
      await compareCheckbox(comparedModels[1]!).focus();
      await page.keyboard.press("Space");
      check(
        "a second Space adds the second Model to the URL",
        (await checkedCompareCount()) === 2 &&
          queryString().includes(`compare=${comparedIds.join(",")}`),
        queryString(),
      );

      // The 4-Model cap: once four Models are selected, the other rows'
      // checkboxes disable (unchecking always works).
      const extra = models
        .filter((model) => model.id !== comparedIds[0] && model.id !== comparedIds[1])
        .slice(0, 2);
      for (const model of extra) {
        await compareCheckbox(model).focus();
        await page.keyboard.press("Space");
      }
      check(
        "the link counts 4 compared Models",
        ((await page.locator("a.compare-link").textContent()) ?? "").trim() ===
          "Compare selected (4)",
      );
      check(
        "at 4 compared Models the remaining checkboxes disable",
        (await page.locator('tbody input[type="checkbox"]:disabled').count()) ===
          models.length - 4,
      );

      await compareCheckbox(extra[0]!).focus();
      await page.keyboard.press("Space");
      check(
        "unchecking always works and re-enables the other rows",
        (await checkedCompareCount()) === 3 &&
          (await page.locator('tbody input[type="checkbox"]:disabled').count()) === 0,
      );
      await compareCheckbox(extra[1]!).focus();
      await page.keyboard.press("Space");

      // Enter on the Compare selected link completes the keyboard path.
      await page.locator("a.compare-link").focus();
      await page.keyboard.press("Enter");
      await waitForH1("Compare Models");
      check(
        "Enter on Compare selected opens the compare route",
        pathname() === "/compare",
        page.url(),
      );
      check(
        "the two keyboard-selected Models head the side-by-side table",
        JSON.stringify(await allTexts(page.locator("table thead th"))) ===
          JSON.stringify(["Model", comparedModels[0]!.name, comparedModels[1]!.name]),
      );
    });
  }
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
