import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * Ticket 13 — themes and performance, asserted over the built output.
 *
 * 1. The no-flash theme script: index.html must carry a small inline script
 *    in <head>, BEFORE the stylesheet and the module script, that applies a
 *    stored theme choice (localStorage "llm-bench-theme") to
 *    documentElement before first paint — so a reload in the other theme
 *    never flashes the wrong palette.
 * 2. Self-hosted assets only: every src/href in the built index.html must be
 *    a local path (no external fonts, CDNs, or analytics — ADR-0004 keeps
 *    the static site free of third-party requests and the load budget lean).
 * 3. Transfer budget: the gzipped total of everything the first page load
 *    downloads (HTML + JS + CSS) stays under 250 kB, the documented budget
 *    for "a typical broadband page load completes in under two seconds"
 *    (the bundle is the only variable part; local-serve timing is measured
 *    by the browser check).
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");

function runBuild(): { status: number | null; output: string } {
  // NODE_ENV=production so Vite minifies exactly like a real deploy — the
  // vitest environment sets NODE_ENV=test, which would skip minification
  // and overstate the transferred size.
  const result = spawnSync("pnpm", ["build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function readDistIndexHtml(): string {
  return readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
}

function listDistFiles(dir = DIST_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listDistFiles(full) : [full];
  });
}

describe("themes and performance over the built site (ticket 13)", () => {
  it(
    "ships the no-flash theme script before any stylesheet or module script",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const html = readDistIndexHtml();

      // The inline script reads the stored choice and applies it to the
      // document element — the exact mechanism the browser check exercises.
      expect(html).toContain("llm-bench-theme");
      expect(html).toMatch(/documentElement/);

      const scriptStart = html.indexOf("<script>");
      expect(scriptStart).toBeGreaterThanOrEqual(0);
      expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
      expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('<script type="module"'));

      // The toggle wiring ships in the bundle: an explicit theme choice is
      // announced (aria-pressed) and labelled with the theme's name.
      const assets = listDistFiles(path.join(DIST_DIR, "assets"));
      const bundle = assets.map((file) => readFileSync(file, "utf8")).join("\n");
      expect(bundle).toContain("theme-toggle");
      expect(bundle).toContain("Theme:");
    },
    480_000,
  );

  it(
    "references only self-hosted assets (no external fonts, CDNs, or analytics)",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const html = readDistIndexHtml();
      const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);
      expect(references.length).toBeGreaterThan(0);
      const external = references.filter((ref) => /^https?:\/\//.test(ref));
      expect(external, `external references: ${external.join(", ")}`).toEqual([]);
    },
    480_000,
  );

  it(
    "keeps the total transferred page (HTML + JS + CSS, gzipped) under the 250 kB budget",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const files = listDistFiles();
      expect(files.length).toBeGreaterThan(0);

      let total = 0;
      const breakdown: string[] = [];
      for (const file of files) {
        const raw = readFileSync(file);
        const gzipped = gzipSync(raw, { level: 9 }).length;
        total += gzipped;
        breakdown.push(`${path.relative(DIST_DIR, file)}: ${raw.length} B → ${gzipped} B gzip`);
      }
      console.log(`transfer budget: ${total} bytes gzipped total\n  ${breakdown.join("\n  ")}`);

      // Documented budget (impl-13): ~117 kB today, 250 kB ceiling — a full
      // page load at a typical 10 Mbps broadband connection spends well
      // under a second downloading this, leaving the sub-2s story headroom.
      expect(total).toBeLessThan(250 * 1024);
    },
    480_000,
  );
});
