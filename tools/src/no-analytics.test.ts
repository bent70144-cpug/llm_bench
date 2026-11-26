import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ticket 14 — the ADR-0004 audit: the built site must not call out to
 * anyone. Vercel Hobby non-commercial hosting is kept free of analytics,
 * ads, and accounts partly by policy and partly by bytes: the shipped
 * JavaScript must contain no network-call primitives at all, so no beacon
 * can be added silently.
 *
 * The distinction that matters: the site LINKS OUT to every Score's source
 * URL (anchors with href, opened by the visitor) but must never CALL those
 * or any other origins — all data is bundled at build time from
 * @llm-bench/data, so a page load after the initial fetch of the static
 * assets makes zero network requests.
 *
 * Patterns are matched as plain substrings (no word boundaries needed for
 * these identifiers); vendor names are domain/API-anchored on purpose —
 * bare "plausible" and "segment" appear in Benchmark prose (MMLU-Pro's
 * contamination notes, the compare view's "dashed segment") and are not
 * beacons.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");

/** Network-call primitives: any beacon, tracker, or remote fetch needs one. */
const NETWORK_PRIMITIVES = [
  "fetch(",
  "XMLHttpRequest",
  "sendBeacon",
  "EventSource",
  "WebSocket",
  "new Image(",
] as const;

/** Known analytics/ad vendor domains and loader globals, defense in depth. */
const VENDOR_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "gtag(",
  "doubleclick.net",
  "adsbygoogle",
  "googlesyndication.com",
  "plausible.io",
  "mixpanel.com",
  "segment.io",
  "cdn.segment.com",
  "hotjar.com",
  "posthog.com",
  "clarity.ms",
  "umami.is",
  "matomo",
  "amplitude.com",
  "heapanalytics.com",
  "sentry.io",
  "datadoghq.com",
  "newrelic.com",
  "nr-data.net",
  "fbq(",
  "connect.facebook.net",
] as const;

function runBuild(): { status: number | null; output: string } {
  // NODE_ENV=production so Vite minifies exactly like a real deploy — the
  // vitest environment sets NODE_ENV=test, which would skip minification.
  const result = spawnSync("pnpm", ["build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function listDistFiles(dir = DIST_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listDistFiles(full) : [full];
  });
}

function occurrencesOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("the built site makes no network calls (ticket 14, ADR-0004)", () => {
  it(
    "ships no network-call primitives in the built JavaScript",
    () => {
      const build = runBuild();
      expect(build.status, `pnpm build failed:\n${build.output}`).toBe(0);

      const jsFiles = listDistFiles(path.join(DIST_DIR, "assets")).filter((file) => file.endsWith(".js"));
      expect(jsFiles.length).toBeGreaterThan(0);
      const bundle = jsFiles.map((file) => readFileSync(file, "utf8")).join("\n");

      const found: string[] = [];
      for (const primitive of NETWORK_PRIMITIVES) {
        const count = occurrencesOf(bundle, primitive);
        if (count > 0) found.push(`${primitive} ×${count}`);
      }
      expect(
        found,
        `network-call primitives in the bundle: ${found.join(", ")} — the static site must not fetch, beacon, or open sockets`,
      ).toEqual([]);
    },
    480_000,
  );

  it(
    "ships no analytics or ad vendor identifiers in any built file",
    () => {
      const build = runBuild();
      expect(build.status, `pnpm build failed:\n${build.output}`).toBe(0);

      const files = listDistFiles();
      expect(files.length).toBeGreaterThan(0);
      const everything = files.map((file) => readFileSync(file, "utf8")).join("\n");

      const found: string[] = [];
      for (const vendor of VENDOR_PATTERNS) {
        const count = occurrencesOf(everything, vendor);
        if (count > 0) found.push(`${vendor} ×${count}`);
      }
      expect(found, `analytics/ad identifiers in the build: ${found.join(", ")}`).toEqual([]);
    },
    480_000,
  );

  it(
    "links out to source URLs but never calls them",
    () => {
      const build = runBuild();
      expect(build.status, `pnpm build failed:\n${build.output}`).toBe(0);

      const jsFiles = listDistFiles(path.join(DIST_DIR, "assets")).filter((file) => file.endsWith(".js"));
      const bundle = jsFiles.map((file) => readFileSync(file, "utf8")).join("\n");

      // The positive half of the contract: every Score's source URL is
      // bundled so the UI can link to it — the origins ARE in the bytes,
      // as anchor hrefs, while the network primitives above stay absent.
      const scores = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/data/scores.json"), "utf8")) as Array<{
        sourceUrl: string;
      }>;
      expect(scores.length).toBeGreaterThan(0);
      const hostname = new URL(scores[0]!.sourceUrl).hostname;
      expect(bundle, `the ${hostname} source URL must ship in the bundle as a link`).toContain(hostname);
    },
    480_000,
  );

  it(
    "loads no remote fonts or assets from the built stylesheet",
    () => {
      const build = runBuild();
      expect(build.status, `pnpm build failed:\n${build.output}`).toBe(0);

      const cssFiles = listDistFiles(path.join(DIST_DIR, "assets")).filter((file) => file.endsWith(".css"));
      const css = cssFiles.map((file) => readFileSync(file, "utf8")).join("\n");
      expect(css).not.toMatch(/https?:\/\//);
      // Every url() target, if any, must be a local path.
      const remoteUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]!).filter((url) => /^['"]?https?:/.test(url));
      expect(remoteUrls, `remote CSS assets: ${remoteUrls.join(", ")}`).toEqual([]);
    },
    480_000,
  );
});
