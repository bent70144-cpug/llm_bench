import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Benchmark } from "@llm-bench/schema";
import { defaultSelectedBenchmarkIds } from "@llm-bench/scoring";
import { DATA_FILE_NAMES, runManage } from "./cli-test-utils";

/**
 * End-to-end proof (ticket 02): adding a Model through the CRUD CLI and
 * rebuilding (`pnpm build`) changes the rendered leaderboard, because the
 * web app renders 100% from the data package. The test temporarily mutates
 * the real packages/data directory through the CLI's default --data-dir,
 * asserts the built bundle contains the new Model, then restores the
 * original files byte-for-byte and rebuilds so no fixture data survives in
 * the data package or the build output. It refuses to run over uncommitted
 * packages/data edits so it can never clobber real work.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = path.join(REPO_ROOT, "packages/data");
const DIST_ASSETS = path.join(REPO_ROOT, "apps/web/dist/assets");

const PROOF_MODEL = {
  id: "e2e-leaderboard-proof-model",
  name: "E2E Leaderboard Proof Model",
  provider: "E2E Proof Provider",
  license: "proprietary",
  releaseDate: "2026-11-20",
  contextWindow: 200000,
  inputPricePer1M: 1.0,
  outputPricePer1M: 2.0,
  referenceInferenceProvider: null,
  lastUpdated: "2026-11-26",
  sourceUrl: "https://example.com/e2e-leaderboard-proof-model",
};

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

describe("leaderboard end-to-end proof", () => {
  it(
    "adding a Model through the CLI changes the rendered leaderboard after pnpm build",
    () => {
      // Never clobber uncommitted real-data edits.
      const status = spawnSync("git", ["status", "--porcelain", "--", "packages/data"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(status.status).toBe(0);
      if (status.stdout.trim() !== "") {
        throw new Error(
          `packages/data has uncommitted changes; commit or stash them before running the end-to-end proof:\n${status.stdout}`,
        );
      }

      const originalFiles = new Map<string, string>(
        DATA_FILE_NAMES.map((name) => [name, readFileSync(path.join(DATA_DIR, name), "utf8")]),
      );

      let cliWroteFiles = false;
      try {
        // No --data-dir: exercise the CLI's default, the real data package.
        const add = runManage(["add", "model", "--json", JSON.stringify(PROOF_MODEL)]);
        if (add.status === 0) {
          cliWroteFiles = true;
        }
        expect(add.status).toBe(0);
        expect(add.output).toContain("e2e-leaderboard-proof-model");

        const build = runBuild();
        expect(build.status).toBe(0);

        // The leaderboard is data-driven, so the bundled data must carry the
        // new Model (it renders as a row with "n/a" cells — no Scores).
        expect(readBuiltBundle()).toContain(PROOF_MODEL.name);
      } finally {
        if (cliWroteFiles) {
          for (const [name, content] of originalFiles) {
            writeFileSync(path.join(DATA_DIR, name), content, "utf8");
          }
          // Rebuild so the build output carries real data only, and prove
          // the fixture Model is gone after the restore.
          const rebuild = runBuild();
          if (rebuild.status !== 0) {
            console.error(`restoring the build failed:\n${rebuild.output}`);
          }
        }
      }

      // The data package is restored byte-for-byte.
      for (const name of DATA_FILE_NAMES) {
        expect(readFileSync(path.join(DATA_DIR, name), "utf8")).toBe(originalFiles.get(name));
      }
      // The rebuilt leaderboard no longer contains the fixture Model.
      expect(readBuiltBundle()).not.toContain(PROOF_MODEL.name);
    },
    480_000,
  );

  it(
    "renders the full Benchmark catalogue with a Tier-driven default selection",
    () => {
      const catalogue = JSON.parse(
        readFileSync(path.join(DATA_DIR, "benchmarks.json"), "utf8"),
      ) as Benchmark[];
      expect(catalogue).toHaveLength(17);

      const build = runBuild();
      expect(build.status).toBe(0);

      const bundle = readBuiltBundle();

      // The leaderboard renders 100% from the data package, so every
      // Benchmark name — column or selection control — must be in the bundle.
      for (const benchmark of catalogue) {
        expect(bundle).toContain(benchmark.name);
      }

      // Tier drives the default selection: running the real derivation over
      // the real catalogue selects exactly the 12 core-Tier Benchmarks and
      // leaves the 5 extended-Tier ones unselected…
      const coreIds = catalogue.filter((b) => b.tier === "core").map((b) => b.id);
      const extendedIds = catalogue.filter((b) => b.tier === "extended").map((b) => b.id);
      expect(coreIds).toHaveLength(12);
      expect(extendedIds).toHaveLength(5);
      expect([...defaultSelectedBenchmarkIds(catalogue)].sort()).toEqual([...coreIds].sort());

      // …and the shipped bundle carries both the catalogue data (12 core-Tier
      // and 5 extended-Tier Benchmark records) and the Tier-derived selection
      // logic that defaults the selection to the core Tier.
      expect(bundle.match(/"tier":"core"/g)).toHaveLength(12);
      expect(bundle.match(/"tier":"extended"/g)).toHaveLength(5);
      expect(bundle).toMatch(
        /\.tier\s*===?\s*["'`]core["'`]|["'`]core["'`]\s*===?\s*[A-Za-z_$][\w$]*\.tier/,
      );
    },
    480_000,
  );
});
