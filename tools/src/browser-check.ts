import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LICENSE_VALUES, type Benchmark, type Model, type Score } from "@llm-bench/schema";
import {
  computeAverage,
  defaultSelectedBenchmarkIds,
  encodeLeaderboardUrlState,
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
 * Ticket 06 covers Benchmark weights and shareable URL state: a weight
 * change reorders the rows and switches the aggregate label to Weighted
 * Average, the view is written to the URL as query parameters, and opening
 * or refreshing a shared URL restores the exact selection, weights, sorting,
 * search, and filters.
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

  // --- Ticket 06: Benchmark weights and shareable URL state ---------------

  /** The aggregate column header's button text ("Average ▼" / "Weighted Average ▼"). */
  const aggregateHeaderText = async (): Promise<string> =>
    (await page.locator("thead th").nth(6).locator("button").textContent()) ?? "";

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
