import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DatasetSchema,
  type Benchmark,
  type Dataset,
  type Score,
} from "@llm-bench/schema";

/**
 * Shared data-package loading, validation, and writing for the LLM Bench
 * tools commands (validate-data, manage-data, import-scores).
 *
 * Every command goes through the same gate: read the five JSON files, apply
 * any change in memory, run validateDataset on the result, and only then
 * write — so no command can persist data the validation gate would reject.
 *
 * Error messages are location-prefixed and name the offending record, e.g.
 * `scores.json[3] (model-a on bench-1): publishedDate: …`.
 */

export const DATA_FILE_BY_KEY = {
  models: "models.json",
  benchmarks: "benchmarks.json",
  scores: "scores.json",
  evaluationSettings: "evaluation-settings.json",
  pricingConfig: "pricing-config.json",
} as const;

export type DatasetKey = keyof typeof DATA_FILE_BY_KEY;

/** The four data files that hold arrays of records. */
export type ArrayDatasetKey = "models" | "benchmarks" | "scores" | "evaluationSettings";

/** The five data files as parsed JSON, before schema validation. */
export interface RawDataset {
  models: unknown;
  benchmarks: unknown;
  scores: unknown;
  evaluationSettings: unknown;
  pricingConfig: unknown;
}

/**
 * A RawDataset whose array files are confirmed to be arrays and whose
 * pricing config is an object — safe for the CRUD and import commands to
 * mutate before revalidation.
 */
export interface MutableDataset {
  models: Record<string, unknown>[];
  benchmarks: Record<string, unknown>[];
  scores: Record<string, unknown>[];
  evaluationSettings: Record<string, unknown>[];
  pricingConfig: Record<string, unknown>;
}

const DATASET_KEYS = Object.keys(DATA_FILE_BY_KEY) as DatasetKey[];

export function readRawDataset(
  dataDir: string,
): { dataset: RawDataset | undefined; errors: string[] } {
  const dataset: Partial<RawDataset> = {};
  const errors: string[] = [];
  for (const key of DATASET_KEYS) {
    const fileName = DATA_FILE_BY_KEY[key];
    try {
      dataset[key] = JSON.parse(readFileSync(path.join(dataDir, fileName), "utf8")) as unknown;
    } catch (error) {
      const reason =
        error instanceof SyntaxError
          ? `invalid JSON (${error.message})`
          : error instanceof Error
            ? error.message
            : String(error);
      errors.push(`${fileName}: cannot read file (${reason})`);
    }
  }
  if (errors.length > 0) {
    return { dataset: undefined, errors };
  }
  return { dataset: dataset as RawDataset, errors: [] };
}

const ARRAY_KEYS: readonly ArrayDatasetKey[] = [
  "models",
  "benchmarks",
  "scores",
  "evaluationSettings",
];

export function readMutableDataset(
  dataDir: string,
): { dataset: MutableDataset | undefined; errors: string[] } {
  const { dataset, errors } = readRawDataset(dataDir);
  if (!dataset) {
    return { dataset: undefined, errors };
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(dataset[key])) {
      errors.push(`${DATA_FILE_BY_KEY[key]}: expected a JSON array`);
    }
  }
  if (
    dataset.pricingConfig === null ||
    typeof dataset.pricingConfig !== "object" ||
    Array.isArray(dataset.pricingConfig)
  ) {
    errors.push(`${DATA_FILE_BY_KEY.pricingConfig}: expected a JSON object`);
  }
  if (errors.length > 0) {
    return { dataset: undefined, errors };
  }
  return {
    dataset: {
      models: dataset.models as Record<string, unknown>[],
      benchmarks: dataset.benchmarks as Record<string, unknown>[],
      scores: dataset.scores as Record<string, unknown>[],
      evaluationSettings: dataset.evaluationSettings as Record<string, unknown>[],
      pricingConfig: dataset.pricingConfig as Record<string, unknown>,
    },
    errors: [],
  };
}

function fileNameForKey(key: string | undefined): string {
  if (key === undefined) {
    return "(root)";
  }
  return DATA_FILE_BY_KEY[key as DatasetKey] ?? "(root)";
}

/**
 * Human-readable identity of the offending record, so messages name the
 * record (glossary vocabulary: Model id, Benchmark id, Model on Benchmark).
 */
function recordLabel(key: string, record: unknown): string | null {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const r = record as Record<string, unknown>;
  if (key === "scores" && typeof r.modelId === "string" && typeof r.benchmarkId === "string") {
    return `${r.modelId} on ${r.benchmarkId}`;
  }
  if (typeof r.id === "string") {
    return r.id;
  }
  if (typeof r.name === "string") {
    return r.name;
  }
  return null;
}

function formatSchemaIssue(
  dataset: RawDataset,
  issue: { path: readonly PropertyKey[]; message: string },
): string {
  const segments = issue.path.map(String);
  const topLevel = segments[0];
  const fileName = fileNameForKey(topLevel);
  const isRecordArray =
    topLevel !== undefined &&
    (ARRAY_KEYS as readonly string[]).includes(topLevel) &&
    segments.length >= 2 &&
    /^\d+$/.test(segments[1] ?? "");
  if (isRecordArray) {
    const index = Number(segments[1]);
    const records = dataset[topLevel as ArrayDatasetKey];
    const record = Array.isArray(records) ? records[index] : undefined;
    const label = recordLabel(topLevel, record);
    const located = label ? `${fileName}[${index}] (${label})` : `${fileName}[${index}]`;
    const field = segments.slice(2).join(".");
    return field ? `${located}: ${field}: ${issue.message}` : `${located}: ${issue.message}`;
  }
  const location =
    segments.length > 1
      ? `${fileName}: ${segments.slice(1).join(".")}`
      : `${fileName}`;
  return `${location}: ${issue.message}`;
}

/**
 * The location prefix for one Score in validation messages:
 * `scores.json[<index>] (<modelId> on <benchmarkId>)` — the style every
 * tool reports Score problems in. Exported because the pre-launch audit
 * (lib/audit.ts) reports in the same style; takes any record carrying the
 * pair's ids.
 */
export function scoreLocation(
  score: { modelId: string; benchmarkId: string },
  index: number,
): string {
  return `scores.json[${index}] (${score.modelId} on ${score.benchmarkId})`;
}

/**
 * A (Model, Benchmark) pair — the unit the exactly-one-Primary rule and the
 * Source-resolution rule count over. A small typed shape rather than a
 * space-joined string, so a pair's fields stay typed end to end.
 */
interface ScorePair {
  modelId: string;
  benchmarkId: string;
}

/**
 * The map key of a ScorePair. Ids are kebab-case (no spaces), so the
 * space-joined key is unambiguous; it exists only here, behind this
 * function and the ScorePair type.
 */
function scorePairKey(score: ScorePair): string {
  return `${score.modelId} ${score.benchmarkId}`;
}

/**
 * The Canonical sources eligibility and rank of one Score under a
 * Benchmark: the index of its Source type in the ordered Canonical sources
 * list when eligible (Source type listed and, where the entry defines
 * urlPatterns, the source URL matching at least one), or -1 when not.
 * Ineligible Scores never compete for the Primary designation — an
 * ineligible Primary is reported by the eligibility rule instead. A
 * urlPattern that is not a valid regular expression counts as non-matching
 * (the malformed-pattern error is reported separately).
 */
function canonicalRank(score: Score, benchmark: Benchmark): number {
  const rank = benchmark.canonicalSources.findIndex(
    (entry) => entry.sourceType === score.sourceType,
  );
  if (rank === -1) {
    return -1;
  }
  const canonical = benchmark.canonicalSources[rank]!;
  if (canonical.urlPatterns && canonical.urlPatterns.length > 0) {
    const matches = canonical.urlPatterns.some((pattern) => {
      try {
        return new RegExp(pattern).test(score.sourceUrl);
      } catch {
        return false;
      }
    });
    if (!matches) {
      return -1;
    }
  }
  return rank;
}

/** Cross-record integrity rules that Zod cannot express within one object. */
function crossRecordChecks(dataset: Dataset): string[] {
  const errors: string[] = [];
  const modelIds = new Set<string>();
  const benchmarkIds = new Set<string>();

  dataset.models.forEach((model, index) => {
    if (modelIds.has(model.id)) {
      errors.push(`models.json[${index}]: duplicate Model id "${model.id}"`);
    }
    modelIds.add(model.id);
  });

  dataset.benchmarks.forEach((benchmark, index) => {
    if (benchmarkIds.has(benchmark.id)) {
      errors.push(`benchmarks.json[${index}]: duplicate Benchmark id "${benchmark.id}"`);
    }
    benchmarkIds.add(benchmark.id);
    if (benchmark.higherIsBetter !== true) {
      errors.push(
        `benchmarks.json[${index}] (${benchmark.id}): higherIsBetter must be true in v1`,
      );
    }
  });

  const evaluationSettingNames = new Set(
    dataset.evaluationSettings.map((setting) => setting.name),
  );
  dataset.evaluationSettings.forEach((setting, index) => {
    if (!evaluationSettingNames.has(setting.name)) {
      // unreachable, but keeps the vocabulary itself honest
      errors.push(`evaluation-settings.json[${index}]: invalid entry "${setting.name}"`);
    }
  });

  const benchmarksById = new Map(dataset.benchmarks.map((benchmark) => [benchmark.id, benchmark]));

  for (const [index, score] of dataset.scores.entries()) {
    if (!modelIds.has(score.modelId)) {
      errors.push(
        `${scoreLocation(score, index)}: references unknown Model "${score.modelId}"`,
      );
    }
    if (!benchmarkIds.has(score.benchmarkId)) {
      errors.push(
        `${scoreLocation(score, index)}: references unknown Benchmark "${score.benchmarkId}"`,
      );
    }
    if (!evaluationSettingNames.has(score.evaluationSetting)) {
      errors.push(
        `${scoreLocation(score, index)}: Evaluation setting "${score.evaluationSetting}" is not in the evaluation-settings.json vocabulary`,
      );
    }
  }

  const seenTriples = new Set<string>();
  /** Every (Model, Benchmark) pair that has Scores, with its Score and Primary counts. */
  const pairs = new Map<string, { pair: ScorePair; scores: number; primaries: number }>();

  for (const [index, score] of dataset.scores.entries()) {
    const triple = `${score.modelId} ${score.benchmarkId} ${score.evaluationSetting}`;
    if (seenTriples.has(triple)) {
      errors.push(
        `${scoreLocation(score, index)}: duplicate Score for Model "${score.modelId}", Benchmark "${score.benchmarkId}", Evaluation setting "${score.evaluationSetting}"`,
      );
    }
    seenTriples.add(triple);

    const pair: ScorePair = { modelId: score.modelId, benchmarkId: score.benchmarkId };
    const entry = pairs.get(scorePairKey(pair)) ?? { pair, scores: 0, primaries: 0 };
    entry.scores += 1;
    if (score.isPrimary) {
      entry.primaries += 1;
    }
    pairs.set(scorePairKey(pair), entry);
  }

  for (const { pair, primaries } of pairs.values()) {
    if (primaries > 1) {
      errors.push(
        `scores.json: ${primaries} Primary scores for Model "${pair.modelId}" on Benchmark "${pair.benchmarkId}" (exactly one required)`,
      );
    }
  }

  for (const { pair, scores, primaries } of pairs.values()) {
    // Every entry has at least one Score; one Primary is required.
    if (primaries === 0) {
      errors.push(
        `scores.json: Model "${pair.modelId}" has ${scores} Score(s) on Benchmark "${pair.benchmarkId}" but no Primary score (exactly one required)`,
      );
    }
  }

  for (const [index, score] of dataset.scores.entries()) {
    if (!score.isPrimary) continue;
    const benchmark = benchmarksById.get(score.benchmarkId);
    if (!benchmark) continue; // already reported as a foreign-key violation

    const canonical = benchmark.canonicalSources.find((entry) => entry.sourceType === score.sourceType);
    if (!canonical) {
      errors.push(
        `${scoreLocation(score, index)}: Source type "${score.sourceType}" is not in the Canonical sources for Benchmark "${benchmark.id}"`,
      );
      continue;
    }
    if (canonical.urlPatterns && canonical.urlPatterns.length > 0) {
      const matches = canonical.urlPatterns.some((pattern) => {
        try {
          return new RegExp(pattern).test(score.sourceUrl);
        } catch {
          errors.push(
            `benchmarks.json (${benchmark.id}): Canonical sources urlPattern "${pattern}" is not a valid regular expression`,
          );
          return false;
        }
      });
      if (!matches && canonical.urlPatterns.length > 0) {
        errors.push(
          `${scoreLocation(score, index)}: source URL "${score.sourceUrl}" matches no Canonical sources urlPattern for Benchmark "${benchmark.id}"`,
        );
      }
    }
  }

  // Source resolution (spec "Source resolution" and story 31): among a
  // pair's competing eligible Published Results, the highest-ranked
  // Canonical source wins and ties break by newest publishedDate. For every
  // pair with more than one eligible Score, the designated Primary must be a
  // candidate that rule can select: no eligible Score may outrank it, and no
  // same-ranked eligible Score may be newer. When the top candidates tie on
  // BOTH rank and publishedDate the documented rule is inconclusive — the
  // recorded resolution decides, and those pairs are validation-exempt. The
  // real dataset holds eight such ties: the two tau2-bench pairs
  // (claude-opus-4-6, claude-sonnet-4-6) resolved by the documented
  // Retail-domain tie-break (ticket-04 answer, pinned for claude-opus-4-6 in
  // tools/src/published-results.test.ts), and six same-card same-date pairs
  // the rule cannot tell apart (deepseek-v4-pro's with/without-thinking rows
  // on four Benchmarks; the gpt-6-2-astra and gpt-6-2-sol reasoning-effort
  // rows on arc-agi-2).
  const eligibleByPair = new Map<
    string,
    { pair: ScorePair; ranked: { score: Score; index: number; rank: number }[] }
  >();
  for (const [index, score] of dataset.scores.entries()) {
    const benchmark = benchmarksById.get(score.benchmarkId);
    if (!benchmark) continue; // already reported as a foreign-key violation
    const rank = canonicalRank(score, benchmark);
    if (rank === -1) continue; // never competes for Primary
    const pair: ScorePair = { modelId: score.modelId, benchmarkId: score.benchmarkId };
    const entry = eligibleByPair.get(scorePairKey(pair)) ?? { pair, ranked: [] };
    entry.ranked.push({ score, index, rank });
    eligibleByPair.set(scorePairKey(pair), entry);
  }

  for (const { pair, ranked } of eligibleByPair.values()) {
    if (ranked.length < 2) continue; // no competition to resolve
    // Only a pair with exactly one Primary is resolvable; the one-Primary
    // rule above already reports any other count.
    if (pairs.get(scorePairKey(pair))?.primaries !== 1) continue;
    // An ineligible Primary never joins the competition — the eligibility
    // rule above already reports it, so the resolution rule stays silent.
    const primary = ranked.find(({ score }) => score.isPrimary);
    if (!primary) continue;

    const bestRank = Math.min(...ranked.map(({ rank }) => rank));
    if (primary.rank > bestRank) {
      const winner = ranked.find(({ rank }) => rank === bestRank)!;
      errors.push(
        `${scoreLocation(primary.score, primary.index)}: this Primary score loses the Canonical sources resolution for Model "${pair.modelId}" on Benchmark "${pair.benchmarkId}" — Source type "${winner.score.sourceType}" outranks "${primary.score.sourceType}" (the highest-ranked eligible source wins; ties break by newest publishedDate)`,
      );
      continue;
    }

    const topRanked = ranked.filter(({ rank }) => rank === bestRank);
    const newest = topRanked.reduce((left, right) =>
      right.score.publishedDate > left.score.publishedDate ? right : left,
    );
    if (primary.score.publishedDate < newest.score.publishedDate) {
      errors.push(
        `${scoreLocation(primary.score, primary.index)}: this Primary score loses the Canonical sources resolution for Model "${pair.modelId}" on Benchmark "${pair.benchmarkId}" — a same-ranked "${primary.score.sourceType}" Score was published later (${newest.score.publishedDate} vs ${primary.score.publishedDate}; ties break by newest publishedDate)`,
      );
    }
    // Same rank AND same publishedDate among the top candidates: the rule
    // is inconclusive — the recorded resolution stands (exempt above).
  }

  return errors;
}

/** Schema validation plus cross-record checks on an in-memory dataset. */
export function validateDataset(dataset: RawDataset): string[] {
  const errors: string[] = [];
  const parsed = DatasetSchema.safeParse(dataset);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(formatSchemaIssue(dataset, issue));
    }
    return errors;
  }
  errors.push(...crossRecordChecks(parsed.data));
  return errors;
}

/** Read the five data files from a directory and validate them. */
export function validateDataDir(dataDir: string): string[] {
  const { dataset, errors } = readRawDataset(dataDir);
  if (!dataset || errors.length > 0) {
    return errors;
  }
  return validateDataset(dataset);
}

/** Write one data file with the repo's canonical JSON formatting. */
export function writeDatasetFile(dataDir: string, key: DatasetKey, value: unknown): void {
  const filePath = path.join(dataDir, DATA_FILE_BY_KEY[key]);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
