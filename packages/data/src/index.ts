/**
 * @llm-bench/data — the source of truth for LLM Bench.
 *
 * The JSON files next to this module hold real published data only (no
 * placeholder data; ADR-0001). This module re-exports them as typed arrays;
 * it contains no business logic. Averages and rankings are computed at read
 * time by @llm-bench/scoring and are never stored here.
 */
import type {
  Benchmark,
  EvaluationSetting,
  Model,
  PricingConfig,
  Score,
} from "@llm-bench/schema";
import benchmarksJson from "../benchmarks.json";
import evaluationSettingsJson from "../evaluation-settings.json";
import modelsJson from "../models.json";
import pricingConfigJson from "../pricing-config.json";
import scoresJson from "../scores.json";

export const models = modelsJson as Model[];
export const benchmarks = benchmarksJson as Benchmark[];
export const scores = scoresJson as Score[];
export const evaluationSettings = evaluationSettingsJson as EvaluationSetting[];
export const pricingConfig = pricingConfigJson as PricingConfig;
