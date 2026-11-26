import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Score } from "@llm-bench/schema";
import {
  cleanupTempDirs,
  runTool,
  validFixture,
  writeFixture,
  type DataFiles,
} from "./cli-test-utils";

/**
 * Ticket 15 — the pre-launch data audit, the final launch gate.
 *
 * Two contracts are pinned here at the seam-2 CLI boundary:
 *
 * 1. The real data package in packages/data passes the FULL audit
 *    (`validate-data --audit`): every structural rule of `pnpm validate` plus
 *    the zero-placeholder pass over Models, Benchmarks, Scores, the
 *    Evaluation setting vocabulary, and pricing-config. Running inside
 *    `pnpm test` means no placeholder, stub, or unverified Score can merge
 *    — the launch gate holds continuously, not only on audit day.
 * 2. Every audit rule actually fires: each test below mutates one field of a
 *    synthetic fixture (itself structural-valid and audit-clean) and asserts
 *    the CLI exits 1 and names the record, so placeholder data fails a named
 *    check, not a generic one.
 *
 * What is deliberately NOT here: the accuracy review against live sources and
 * the sign-off. Those are the human half of docs/pre-launch-audit.md; they
 * belong to the accountable data owner (docs/DECISIONS.md, "Deliberately left
 * unresolved" #1) and cannot be automated. The audit reads the data — it never
 * fetches a URL.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REAL_DATA_DIR = path.join(REPO_ROOT, "packages/data");

/** The exact command the checklist documents: audit the default data dir. */
function runAudit(args: readonly string[] = []): ReturnType<typeof runTool> {
  return runTool("validate-data.ts", ["--audit", ...args]);
}

/**
 * A synthetic dataset that passes BOTH the structural validation and the
 * audit: realistic-looking ids, names, hosts, and values. (The shared
 * validFixture() in cli-test-utils deliberately uses example.com and stub ids
 * — it is for structural tests only; see the "strictly stronger" test below.)
 */
function auditCleanFixture(): DataFiles {
  return {
    "models.json": [
      {
        id: "nova-2-ultra",
        name: "Nova 2 Ultra",
        provider: "Nova Labs",
        license: "proprietary",
        licenseName: "Nova Labs Terms of Service",
        releaseDate: "2026-01-05",
        contextWindow: 256000,
        inputPricePer1M: 1.5,
        outputPricePer1M: 3.0,
        referenceInferenceProvider: null,
        lastUpdated: "2026-02-01",
        sourceUrl: "https://cards.novalabs.dev/nova-2-ultra",
        notes: "Provider self-reported metadata.",
      },
    ],
    "benchmarks.json": [
      {
        id: "puzzle-pro",
        name: "PuzzlePro",
        category: "reasoning",
        description: "A graduate-level reasoning Benchmark.",
        metric: "Accuracy (percent correct)",
        higherIsBetter: true,
        tier: "core",
        sourceUrl: "https://leaderboard.novalabs.dev/puzzle-pro",
        canonicalSources: [{ sourceType: "provider" }, { sourceType: "leaderboard" }],
        limitations: "Small evaluation set.",
        evaluationSettingNotes: "Providers self-report under varied settings.",
      },
    ],
    "scores.json": [
      {
        modelId: "nova-2-ultra",
        benchmarkId: "puzzle-pro",
        value: 75.5,
        evaluationSetting: "5-shot",
        sourceType: "provider",
        sourceUrl: "https://cards.novalabs.dev/nova-2-ultra",
        publishedDate: "2026-01-10",
        retrievedDate: "2026-02-01",
        verified: true,
        isPrimary: true,
      },
    ],
    "evaluation-settings.json": [{ name: "5-shot", description: "Five-shot prompting." }],
    "pricing-config.json": { inputWeight: 3, outputWeight: 1 },
  };
}

function auditFixtureDir(): string {
  return writeFixture(auditCleanFixture());
}

function firstOf(fixture: DataFiles, file: "models.json" | "benchmarks.json" | "scores.json") {
  const first = (fixture[file] as Array<Record<string, unknown>>)[0];
  if (!first) {
    throw new Error(`fixture has no record in ${file}`);
  }
  return first;
}

afterAll(cleanupTempDirs);

describe("the pre-launch audit over the real data package (ticket 15)", () => {
  it("passes the full audit: structural checks plus the zero-placeholder pass", () => {
    const result = runAudit();

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("audit clean");
    // The summary must state what was checked, in glossary vocabulary.
    expect(result.output).toContain("Score");
    expect(result.output).toContain("verified");
    expect(result.output).toContain("zero placeholder data");
  });

  it("enumerates no unverified Score and complete provenance on every Score", () => {
    // Belt-and-braces alongside the CLI: the real scores.json read directly,
    // so a missing provenance field fails a named test even if the CLI were
    // weakened. Provenance = Source type, source URL, publishedDate,
    // retrievedDate, Evaluation setting, verified status.
    const scores = JSON.parse(
      readFileSync(path.join(REAL_DATA_DIR, "scores.json"), "utf8"),
    ) as Score[];

    expect(scores.length).toBeGreaterThan(0);
    for (const score of scores) {
      expect(score.verified, `${score.modelId} on ${score.benchmarkId}`).toBe(true);
      expect(score.sourceType, `${score.modelId} on ${score.benchmarkId}`).toBeTruthy();
      expect(score.sourceUrl, `${score.modelId} on ${score.benchmarkId}`).toMatch(/^https:\/\//);
      expect(score.publishedDate, `${score.modelId} on ${score.benchmarkId}`).toBeTruthy();
      expect(score.retrievedDate, `${score.modelId} on ${score.benchmarkId}`).toBeTruthy();
      expect(score.evaluationSetting, `${score.modelId} on ${score.benchmarkId}`).toBeTruthy();
    }
  });
});

describe("audit mode rejects placeholder data (synthetic fixtures)", () => {
  it("passes a structural-valid, audit-clean dataset in both plain and audit mode", () => {
    const dir = auditFixtureDir();

    const plain = runTool("validate-data.ts", ["--data-dir", dir]);
    expect(plain.status, plain.output).toBe(0);

    const audit = runAudit(["--data-dir", dir]);
    expect(audit.status, audit.output).toBe(0);
    expect(audit.output).toContain("audit clean");
  });

  it("fails on an unverified Score", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "scores.json").verified = false;
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("nova-2-ultra on puzzle-pro");
    expect(result.output).toContain("verified");
  });

  it("fails on a missing provenance field (sourceUrl removed from a Score)", () => {
    const fixture = auditCleanFixture();
    delete firstOf(fixture, "scores.json").sourceUrl;
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("sourceUrl");
  });

  it("fails on a Score value exactly at the 0 or 100 bound", () => {
    for (const boundValue of [0, 100]) {
      const fixture = auditCleanFixture();
      firstOf(fixture, "scores.json").value = boundValue;
      const dir = writeFixture(fixture);

      const result = runAudit(["--data-dir", dir]);

      expect(result.status, `value ${boundValue} must fail the audit`).toBe(1);
      expect(result.output).toContain("nova-2-ultra on puzzle-pro");
      expect(result.output).toContain("bound");
    }
  });

  it("fails on placeholder markers (TBD, TODO, placeholder, FIXME, XXX, ???) in any data field", () => {
    for (const marker of ["TBD", "TODO", "placeholder", "FIXME", "XXX", "???"]) {
      const fixture = auditCleanFixture();
      firstOf(fixture, "models.json").notes = `Pricing ${marker}`;
      const dir = writeFixture(fixture);

      const result = runAudit(["--data-dir", dir]);

      expect(result.status, `marker ${marker} must fail the audit`).toBe(1);
      expect(result.output).toContain("nova-2-ultra");
      expect(result.output).toContain(marker.toLowerCase());
    }
  });

  it("fails on a placeholder marker inside a Score's Evaluation setting", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "scores.json").evaluationSetting = "TBD";
    fixture["evaluation-settings.json"] = [{ name: "TBD", description: "Unsettled." }];
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Evaluation setting");
  });

  it("fails on an empty or whitespace-only string field", () => {
    for (const emptyValue of ["", "   "]) {
      const fixture = auditCleanFixture();
      firstOf(fixture, "models.json").notes = emptyValue;
      const dir = writeFixture(fixture);

      const result = runAudit(["--data-dir", dir]);

      expect(result.status, JSON.stringify(emptyValue)).toBe(1);
      expect(result.output).toContain("nova-2-ultra");
      expect(result.output).toContain("notes");
    }
  });

  it("fails on an obviously-fake source URL (reserved example.com host)", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "scores.json").sourceUrl = "https://example.com/nova-2-ultra";
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("nova-2-ultra on puzzle-pro");
    expect(result.output).toContain("example.com");
  });

  it("fails on a non-https source URL", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "models.json").sourceUrl = "http://cards.novalabs.dev/nova-2-ultra";
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("nova-2-ultra");
    expect(result.output).toContain("https");
  });

  it("fails on a $0 price (self-hosted / no public API rate is null, never 0)", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "models.json").inputPricePer1M = 0;
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("nova-2-ultra");
    expect(result.output).toContain("inputPricePer1M");
  });

  it("fails on stub identifiers and names (model-a, Model A, Provider A)", () => {
    const fixture = auditCleanFixture();
    const model = firstOf(fixture, "models.json");
    model.id = "model-a";
    model.name = "Model A";
    model.provider = "Provider A";
    // Keep the Score's reference intact so structural validation passes and
    // the stub rules themselves are what fail the audit.
    firstOf(fixture, "scores.json").modelId = "model-a";
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("stub");
  });

  it("fails when a Primary score is ineligible under the Benchmark's Canonical sources", () => {
    const fixture = auditCleanFixture();
    firstOf(fixture, "scores.json").sourceType = "third-party";
    const dir = writeFixture(fixture);

    const result = runAudit(["--data-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Canonical sources");
  });

  it("is strictly stronger than plain validation (the structural fixture is not audit-clean)", () => {
    // The shared validFixture() (stub ids, example.com hosts) must keep
    // passing plain `pnpm validate` — structural behaviour is unchanged —
    // while audit mode rejects it: the pre-launch gate is the strictest
    // check in the repository.
    const dir = writeFixture(validFixture());

    const plain = runTool("validate-data.ts", ["--data-dir", dir]);
    expect(plain.status, plain.output).toBe(0);

    const audit = runAudit(["--data-dir", dir]);
    expect(audit.status).toBe(1);
  });
});

describe("the committed audit checklist (docs/pre-launch-audit.md)", () => {
  it("exists and documents the real commands it points at", () => {
    const checklist = readFileSync(
      path.join(REPO_ROOT, "docs/pre-launch-audit.md"),
      "utf8",
    );

    // The launch gate must stay wired to the actual CLIs and tests.
    expect(checklist).toContain("pnpm validate");
    expect(checklist).toContain("pnpm --filter tools validate --audit");
    expect(checklist).toContain("pre-launch-audit.test.ts");
    expect(checklist).toContain("no-analytics.test.ts");
    expect(checklist).toContain("published-results.test.ts");
  });

  it("records the ownership chain and the pending, unsigned sign-off", () => {
    const checklist = readFileSync(
      path.join(REPO_ROOT, "docs/pre-launch-audit.md"),
      "utf8",
    );

    // The sign-off belongs solely to the accountable data owner, whose
    // identity docs/DECISIONS.md records as deliberately unresolved.
    expect(checklist).toContain("data owner");
    expect(checklist).toContain("Deliberately left unresolved");
    expect(checklist).toContain("CODEOWNERS");

    // Pre-launch state: the sign-off is explicitly pending and unsigned.
    // When the user supplies the data owner and the sign-off happens, these
    // assertions are flipped DELIBERATELY as part of that change — updating
    // this test is part of opening the gate.
    expect(checklist).toContain("PENDING");
    expect(checklist).toContain("*(pending — to be supplied by the user)*");
    expect(checklist).toContain("*(unsigned)*");
    expect(checklist).toContain("*(none)*");
  });
});
