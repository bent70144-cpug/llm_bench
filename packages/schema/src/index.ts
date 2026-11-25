import { z } from "zod";

/**
 * @llm-bench/schema — the single source of truth for LLM Bench data types.
 *
 * Zod schemas define the shape of every JSON file in @llm-bench/data, and
 * the inferred TypeScript types are what @llm-bench/scoring, tools, and the
 * web app consume. Adding a field is a schema change; adding an Evaluation
 * setting is a data change (see EvaluationSettingSchema).
 */

/** Stable ids are kebab-case (`gpt-5-2`, `gpqa-diamond`). */
const kebabId = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "ids must be kebab-case (lowercase letters, digits, hyphens)");

const isoDate = z.iso.date();

const sourceUrl = z.url();

/** License: the coarse category of a Model's distribution terms. */
export const LICENSE_VALUES = ["proprietary", "open-weights", "open-source"] as const;
export const LicenseSchema = z.enum(LICENSE_VALUES);
export type License = z.infer<typeof LicenseSchema>;

/** Source type: the provenance class of a Score. */
export const SourceTypeSchema = z.enum(["provider", "paper", "leaderboard", "third-party"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * Benchmark category: the agreed nine-value taxonomy from the researched
 * 17-Benchmark catalogue (notes/llm-bench/benchmarks.md, explorer 0-a).
 * Every value is used by at least one Benchmark in the catalogue.
 */
export const BenchmarkCategorySchema = z.enum([
  "knowledge",
  "reasoning",
  "math",
  "coding",
  "instruction-following",
  "agentic",
  "long-context",
  "commonsense",
  "robustness",
]);
export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;

/** Tier: a Benchmark's role in the default selection. */
export const BenchmarkTierSchema = z.enum(["core", "extended"]);
export type BenchmarkTier = z.infer<typeof BenchmarkTierSchema>;

/**
 * Model: one released checkpoint of a language model (ADR-0002). A new
 * checkpoint is a new Model; corrections replace the Score in place.
 *
 * Price invariant: input and output prices are either both present or both
 * null (null means "self-hosted / no public API rate"). The Reference
 * inference provider is non-null only when a third party supplies the rate,
 * and must be null whenever the prices are null.
 *
 * Records are strict objects: unknown fields are rejected so typo'd keys
 * (e.g. "licence") can never reach a data file.
 */
export const ModelSchema = z
  .strictObject({
    id: kebabId,
    name: z.string().min(1),
    provider: z.string().min(1),
    license: LicenseSchema,
    licenseName: z.string().min(1).optional(),
    releaseDate: isoDate,
    contextWindow: z.number().int().positive(),
    inputPricePer1M: z.number().min(0).nullable(),
    outputPricePer1M: z.number().min(0).nullable(),
    referenceInferenceProvider: z.string().min(1).nullable(),
    lastUpdated: isoDate,
    sourceUrl,
    notes: z.string().optional(),
  })
  .refine((model) => (model.inputPricePer1M === null) === (model.outputPricePer1M === null), {
    error: "inputPricePer1M and outputPricePer1M must be both present or both null",
    path: ["outputPricePer1M"],
  })
  .refine((model) => !(model.inputPricePer1M === null && model.referenceInferenceProvider !== null), {
    error: "referenceInferenceProvider must be null when prices are null (self-hosted / no public API rate)",
    path: ["referenceInferenceProvider"],
  });
export type Model = z.infer<typeof ModelSchema>;

/** One entry of a Benchmark's ordered Canonical sources list. */
export const CanonicalSourceSchema = z.strictObject({
  sourceType: SourceTypeSchema,
  urlPatterns: z.array(z.string().min(1)).optional(),
});
export type CanonicalSource = z.infer<typeof CanonicalSourceSchema>;

/**
 * Benchmark: a named evaluation with a defined metric on a 0–100 percent
 * scale. `higherIsBetter` is true for all v1 Benchmarks (validation enforces
 * it); the field exists so a future lower-is-better Benchmark is an explicit
 * schema and scoring change.
 */
export const BenchmarkSchema = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  category: BenchmarkCategorySchema,
  description: z.string().min(1),
  metric: z.string().min(1),
  higherIsBetter: z.boolean(),
  tier: BenchmarkTierSchema,
  sourceUrl,
  canonicalSources: z.array(CanonicalSourceSchema).min(1),
  limitations: z.string().min(1),
  evaluationSettingNotes: z.string().min(1),
});
export type Benchmark = z.infer<typeof BenchmarkSchema>;

/**
 * Score: a published, sourced measurement of one Model on one Benchmark
 * under a named Evaluation setting (ADR-0001: published results only).
 * publishedDate is when the source published the number; retrievedDate is
 * when we fetched it, so publishedDate must not be after retrievedDate.
 */
export const ScoreSchema = z
  .strictObject({
    modelId: kebabId,
    benchmarkId: kebabId,
    value: z.number().min(0).max(100),
    evaluationSetting: z.string().min(1),
    sourceType: SourceTypeSchema,
    sourceUrl,
    publishedDate: isoDate,
    retrievedDate: isoDate,
    verified: z.boolean(),
    isPrimary: z.boolean(),
  })
  .refine((score) => score.publishedDate <= score.retrievedDate, {
    error: "publishedDate must not be after retrievedDate",
    path: ["publishedDate"],
  });
export type Score = z.infer<typeof ScoreSchema>;

/** One controlled Evaluation setting in the data-owned vocabulary. */
export const EvaluationSettingSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
});
export type EvaluationSetting = z.infer<typeof EvaluationSettingSchema>;

/**
 * Blended-price configuration, stored as data: a 3:1 input-to-output ratio.
 * The divisor is derived from the weight sum (3 + 1 = 4), never stored.
 */
export const PricingConfigSchema = z.strictObject({
  inputWeight: z.number().positive(),
  outputWeight: z.number().positive(),
});
export type PricingConfig = z.infer<typeof PricingConfigSchema>;

/** All data files together. Cross-record rules live in tools/validate-data. */
export const DatasetSchema = z.object({
  models: z.array(ModelSchema),
  benchmarks: z.array(BenchmarkSchema),
  scores: z.array(ScoreSchema),
  evaluationSettings: z.array(EvaluationSettingSchema),
  pricingConfig: PricingConfigSchema,
});
export type Dataset = z.infer<typeof DatasetSchema>;
