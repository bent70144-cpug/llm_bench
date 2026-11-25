import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LICENSE_VALUES, type Benchmark, type Model, type Score } from "@llm-bench/schema";
import {
  computeAverage,
  defaultSelectedBenchmarkIds,
  filterModels,
  isUnderHalfCoverage,
  rankModelsByAverage,
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
 * Ticket 05 covers the leaderboard's ranking and Coverage semantics: the
 * default ranked view, the (n/selected) Coverage beside every Average, the
 * Under 50% Coverage badge, instant recalculation on Benchmark toggles,
 * composed filter+search+sort, and Primary-only displayed cells.
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
  fill(value: string): Promise<void>;
  focus(): Promise<void>;
  hover(): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  locator(selector: string): LocatorLike;
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
   * The text (and class) of one Benchmark cell of one Model's row:
   * `benchmarkId` must be among the selected Benchmarks. `linkText` is the
   * text of the cell's Score value anchor — the cell's own text includes the
   * ⓘ details control beside the value (ticket 07), so value assertions read
   * the anchor, not the whole cell.
   */
  const benchmarkCell = async (
    modelName: string,
    benchmarkId: string,
  ): Promise<{ text: string; className: string; linkText: string }> => {
    const selection = defaultSelectedBenchmarkIds(catalogue);
    const cellIndex =
      7 + // the fixed Model-field cells after the row header (Provider … Coverage)
      selection.indexOf(benchmarkId);
    const rowCount = await page.locator("tbody tr").count();
    for (let index = 0; index < rowCount; index++) {
      const row = page.locator("tbody tr").nth(index);
      const name = (await row.locator("th").first().textContent()) ?? "";
      if (name === modelName) {
        const cell = row.locator("td").nth(cellIndex);
        return {
          text: (await cell.textContent()) ?? "",
          className: (await cell.getAttribute("class")) ?? "",
          linkText: (await cell.locator("a.score-link").textContent()) ?? "",
        };
      }
    }
    return { text: "", className: "", linkText: "" };
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
      opusCell.linkText === String(opusPrimary.value),
      opusCell.linkText,
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
        bestCell.className.includes("best") && bestCell.linkText === String(best),
        `${bestModel.name}: "${bestCell.linkText}" class="${bestCell.className}"`,
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
    ];
    const uiSamples: readonly [label: string, selector: string][] = [
      ["number-input border", "input[type='number']"],
      ["theme-toggle border", "button.theme-toggle"],
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
      ["Current best Score entry", ".best-scores li"],
      ["best-Score source link", ".best-scores a"],
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
