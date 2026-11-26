import { DatasetSchema, type Dataset } from "@llm-bench/schema";
import { readRawDataset, validateDataDir } from "./dataset";

/**
 * The pre-launch data audit (ticket 15) — the zero-placeholder pass that
 * plain `pnpm validate` deliberately does not run.
 *
 * Structural validation (lib/dataset.ts) guarantees the data is WELL FORMED:
 * source URLs present and parseable, publishedDate/retrievedDate present and
 * ordered, a verified boolean on every Score, and every Primary score
 * eligible under its Benchmark's Canonical sources (Source type and URL
 * patterns). This audit additionally guarantees the data is REAL:
 *
 * - every Score is verified against its linked source URL (ADR-0001),
 * - no Score value sits exactly on the 0–100 bounds (the classic stub),
 * - no string field is empty or contains a placeholder marker
 *   (TBD, TODO, FIXME, XXX, …),
 * - every source URL is https and its host is neither a reserved
 *   documentation host (example.com, localhost, *.test, …) nor a canonical
 *   stub host (foo.com, test.dev, …),
 * - no Model carries a $0 price — "self-hosted / no public API rate" is
 *   null, and a $0 rate is not a published rate,
 * - no Model or Benchmark id, name, or Provider is a stub (model-a,
 *   "Model A", "Provider A").
 *
 * The audit reads the data package only; it never fetches a URL. Accuracy
 * against live sources is the human review recorded in
 * docs/pre-launch-audit.md.
 *
 * A genuine Published Result that trips one of these rules (a real 100.0 on
 * some Benchmark, a genuinely free hosted rate) is not silently accepted:
 * the launch gate stays strict, and admitting such a value is an explicit,
 * visible rule amendment in a data PR — never a quiet exception.
 */

/** Case-insensitive substrings that mark a string as placeholder data. */
const PLACEHOLDER_MARKERS = [
  "tbd",
  "tba",
  "todo",
  "fixme",
  "xxx",
  "???",
  "placeholder",
  "coming soon",
  "lorem",
  "ipsum",
  "dummy",
] as const;

/** Canonical stub ids: model-a, bench-1, test-model, placeholder-x, … */
const STUB_ID_PATTERN =
  /^(model|bench|benchmark|test|demo|sample|example|placeholder|dummy|fake|stub|foo|bar|baz|qux|tmp|temp|asdf|qwerty)(-[a-z0-9]+)*$/;

/** Canonical stub display names: "Model A", "Test Model", "Provider A", … */
const STUB_NAME_PATTERN =
  /^(model|bench|benchmark|provider|vendor|test|demo|sample|example|placeholder|dummy|fake|stub)( [a-z0-9]+)*$/i;

/** Reserved hosts (RFC 2606/6761 and friends) that host no real source. */
const RESERVED_HOST_PATTERN = /(^|\.)(localhost|example\.(com|org|net|io|dev)|test|invalid|local)$/;

/** Canonical stub hosts: foo.com, test.dev, placeholder.io, … */
const STUB_HOST_PATTERN =
  /^(www\.)?(foo|bar|baz|qux|quux|test|dummy|placeholder|sample|fake)\.(com|net|org|io|dev)$/;

function isPlaceholderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "127.0.0.1" || /^\d+(\.\d+){3}$/.test(host)) {
    return true;
  }
  return RESERVED_HOST_PATTERN.test(host) || STUB_HOST_PATTERN.test(host);
}

/** Location prefixes in the style of the structural validator. */
function modelLocation(model: { id: string }, index: number): string {
  return `models.json[${index}] (${model.id})`;
}

function benchmarkLocation(benchmark: { id: string }, index: number): string {
  return `benchmarks.json[${index}] (${benchmark.id})`;
}

function scoreLocation(score: { modelId: string; benchmarkId: string }, index: number): string {
  return `scores.json[${index}] (${score.modelId} on ${score.benchmarkId})`;
}

function vocabularyLocation(entry: { name: string }, index: number): string {
  return `evaluation-settings.json[${index}] ("${entry.name}")`;
}

/** Empty strings and placeholder markers, for one optional string field. */
function checkStringField(
  location: string,
  field: string,
  value: string | undefined,
  errors: string[],
): void {
  if (value === undefined) {
    return;
  }
  if (value.trim().length === 0) {
    errors.push(`${location}: ${field}: empty or whitespace-only string`);
    return;
  }
  const lower = value.toLowerCase();
  for (const marker of PLACEHOLDER_MARKERS) {
    if (lower.includes(marker)) {
      errors.push(`${location}: ${field}: contains placeholder marker "${marker}"`);
    }
  }
}

/** https + non-placeholder host, for one source URL field. */
function checkSourceUrl(
  location: string,
  field: string,
  url: string,
  errors: string[],
): void {
  if (!url.startsWith("https://")) {
    errors.push(
      `${location}: ${field} "${url}" must use https — a Published Result source is never fetched over plain http`,
    );
    return;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return; // structural validation already rejects unparseable URLs
  }
  if (isPlaceholderHost(hostname)) {
    errors.push(
      `${location}: ${field} host "${hostname}" is a reserved documentation or stub host — no real source lives there`,
    );
  }
}

/**
 * The audit rules, additive to structural validation: they assume the
 * dataset already passed validateDataset and check for placeholder data.
 */
export function auditDataset(dataset: Dataset): string[] {
  const errors: string[] = [];

  dataset.models.forEach((model, index) => {
    const location = modelLocation(model, index);

    if (STUB_ID_PATTERN.test(model.id)) {
      errors.push(`${location}: id "${model.id}" is a stub identifier — Model ids name real checkpoints`);
    }
    if (STUB_NAME_PATTERN.test(model.name)) {
      errors.push(`${location}: name "${model.name}" is a stub name — Models are named by their Provider`);
    }
    if (STUB_NAME_PATTERN.test(model.provider)) {
      errors.push(`${location}: provider "${model.provider}" is a stub name — name the real Provider`);
    }
    checkStringField(location, "name", model.name, errors);
    checkStringField(location, "provider", model.provider, errors);
    checkStringField(location, "licenseName", model.licenseName, errors);
    checkStringField(location, "notes", model.notes, errors);
    checkSourceUrl(location, "sourceUrl", model.sourceUrl, errors);

    if (model.inputPricePer1M === 0 || model.outputPricePer1M === 0) {
      errors.push(
        `${location}: inputPricePer1M/outputPricePer1M of 0 — "self-hosted / no public API rate" is expressed as null prices, and a $0 rate is not a published rate`,
      );
    }
  });

  dataset.benchmarks.forEach((benchmark, index) => {
    const location = benchmarkLocation(benchmark, index);

    if (STUB_ID_PATTERN.test(benchmark.id)) {
      errors.push(
        `${location}: id "${benchmark.id}" is a stub identifier — Benchmark ids name real Benchmarks`,
      );
    }
    if (STUB_NAME_PATTERN.test(benchmark.name)) {
      errors.push(`${location}: name "${benchmark.name}" is a stub name — Benchmarks are named for what they measure`);
    }
    checkStringField(location, "name", benchmark.name, errors);
    checkStringField(location, "description", benchmark.description, errors);
    checkStringField(location, "metric", benchmark.metric, errors);
    checkStringField(location, "limitations", benchmark.limitations, errors);
    checkStringField(location, "evaluationSettingNotes", benchmark.evaluationSettingNotes, errors);
    benchmark.canonicalSources.forEach((canonical, canonicalIndex) => {
      (canonical.urlPatterns ?? []).forEach((pattern, patternIndex) => {
        checkStringField(
          location,
          `canonicalSources[${canonicalIndex}].urlPatterns[${patternIndex}]`,
          pattern,
          errors,
        );
      });
    });
    checkSourceUrl(location, "sourceUrl", benchmark.sourceUrl, errors);
  });

  dataset.scores.forEach((score, index) => {
    const location = scoreLocation(score, index);

    if (score.verified !== true) {
      errors.push(
        `${location}: verified is ${score.verified} — every Score must be checked against its linked source URL before launch (ADR-0001)`,
      );
    }
    if (score.value === 0 || score.value === 100) {
      errors.push(
        `${location}: value ${score.value} sits exactly on the 0–100 bounds — real Published Results do not land on a bound`,
      );
    }
    checkStringField(location, "Evaluation setting", score.evaluationSetting, errors);
    checkSourceUrl(location, "sourceUrl", score.sourceUrl, errors);
  });

  dataset.evaluationSettings.forEach((entry, index) => {
    const location = vocabularyLocation(entry, index);
    checkStringField(location, "name", entry.name, errors);
    checkStringField(location, "description", entry.description, errors);
  });

  return errors;
}

function auditSummary(dataset: Dataset, dataDir: string): string {
  return (
    `audit clean: ${dataset.models.length} Model(s), ${dataset.benchmarks.length} Benchmark(s), ` +
    `${dataset.scores.length} Score(s), ${dataset.evaluationSettings.length} Evaluation settings — ` +
    `every Score verified, zero placeholder data (${dataDir})`
  );
}

/**
 * The full pre-launch gate for one data directory: structural validation
 * first (identical to plain `pnpm validate`), then the audit rules. Returns
 * the errors of whichever stage failed, or the summary line when clean.
 */
export function auditDataDir(
  dataDir: string,
): { errors: string[]; summary: string | null } {
  const structuralErrors = validateDataDir(dataDir);
  if (structuralErrors.length > 0) {
    return { errors: structuralErrors, summary: null };
  }

  // validateDataDir passed, so the dataset parses; the guard exists only so
  // an internal inconsistency surfaces instead of crashing the audit.
  const { dataset } = readRawDataset(dataDir);
  const parsed = dataset ? DatasetSchema.safeParse(dataset) : undefined;
  if (!parsed?.success) {
    return {
      errors: [
        `internal: ${dataDir} passed validation but could not be parsed for the audit — please report this`,
      ],
      summary: null,
    };
  }

  const auditErrors = auditDataset(parsed.data);
  if (auditErrors.length > 0) {
    return { errors: auditErrors, summary: null };
  }
  return { errors: [], summary: auditSummary(parsed.data, dataDir) };
}
