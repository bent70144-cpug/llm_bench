import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Score } from "@llm-bench/schema";

/**
 * End-to-end proof (ticket 07): every Score on the leaderboard carries its
 * provenance — the value cell links to the source URL, a keyboard-reachable
 * tooltip shows Source type, Evaluation setting, publishedDate,
 * retrievedDate, and the verified status, and a Score details panel lists
 * the Primary score and the alternate Evaluation settings for the pair.
 *
 * This file checks the built bundle: the provenance UI wiring ships, the
 * verified-semantics sentence is exactly the one docs/DECISIONS.md mandates,
 * the forbidden "independently verified/reproduced" claim never ships, and
 * the real alternate-setting Scores from the data package are in the bundle
 * the panel renders from. The interactive behaviour (dialog keyboard flow,
 * focus management) is covered by the browser check.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_ASSETS = path.join(REPO_ROOT, "apps/web/dist/assets");

/**
 * The verified-semantics sentence, mandated by docs/DECISIONS.md and the
 * glossary: verified means the data owner checked the value and Evaluation
 * setting against the linked source URL — never independent reproduction.
 */
const VERIFIED_EXPLANATION =
  "the data owner checked the value and Evaluation setting against the linked Source URL, not an independent reproduction";

function readBuiltBundle(): string {
  const files = readdirSync(DIST_ASSETS);
  return files
    .map((file) => readFileSync(path.join(DIST_ASSETS, file), "utf8"))
    .join("\n");
}

function runBuild(): { status: number | null; output: string } {
  const result = spawnSync("pnpm", ["build"], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe("Score provenance and alternate settings (ticket 07)", () => {
  it(
    "ships the provenance UI wiring and the verified-semantics sentence in the built bundle",
    () => {
      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The provenance affordances: the value cell stays a real anchor to
      // the source URL (checked interactively), the Score details panel and
      // its labels ship, and every provenance field is labelled with the
      // glossary vocabulary.
      expect(bundle).toContain("Score details");
      expect(bundle).toContain("Primary score");
      expect(bundle).toContain("Alternate Evaluation setting");
      expect(bundle).toContain("Source type");
      expect(bundle).toContain("Evaluation setting");
      expect(bundle).toContain("publishedDate");
      expect(bundle).toContain("retrievedDate");
      expect(bundle).toContain("Source URL");
      expect(bundle).toContain("Verified");
      expect(bundle).toContain("Excluded from the Average");

      // The tooltip must explain verified semantics exactly as decided
      // (docs/DECISIONS.md): the data owner checked the value and
      // Evaluation setting against the linked source URL — not independent
      // reproduction.
      expect(bundle).toContain(VERIFIED_EXPLANATION);
      expect(bundle).toContain("Verified means ");

      // And it must never claim independent verification or reproduction.
      expect(bundle).not.toMatch(/independently\s+(?:verified|reproduced)/i);
    },
    480_000,
  );

  it(
    "renders alternate Evaluation settings from the data package, not from web-app code",
    () => {
      const scores = JSON.parse(readFileSync(path.join(DATA_DIR, "scores.json"), "utf8")) as Score[];

      // Real pairs recorded under more than one Evaluation setting — the
      // exact rows the Score details panel lists as alternates.
      const pairs = new Map<string, Score[]>();
      for (const score of scores) {
        const key = `${score.modelId}|${score.benchmarkId}`;
        pairs.set(key, [...(pairs.get(key) ?? []), score]);
      }
      const alternatePairs = [...pairs.values()].filter((pair) => pair.length > 1);
      expect(alternatePairs.length).toBeGreaterThanOrEqual(10);

      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The bundle the panel renders from carries every real alternate
      // Evaluation setting and its source URL: the alternates are pure data,
      // so adding one needs no UI change.
      for (const pair of alternatePairs) {
        for (const score of pair) {
          expect(bundle).toContain(score.evaluationSetting);
          expect(bundle).toContain(score.sourceUrl);
        }
      }
    },
    480_000,
  );
});
