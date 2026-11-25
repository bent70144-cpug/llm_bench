import { readFileSync } from "node:fs";
import path from "node:path";
import { fail, loadForMutation, saveIfValid, usageError, DEFAULT_DATA_DIR } from "./lib/cli";
import type { DatasetKey, MutableDataset } from "./lib/dataset";

/**
 * manage-data — safe CRUD for the @llm-bench/data package (ticket 02).
 *
 * Every mutation applies the change in memory, validates the whole dataset,
 * and only then writes — invalid input exits non-zero and leaves every file
 * unchanged. Deleting a Model or Benchmark that has Scores is refused
 * unless --cascade is given (the cascade deletes those Scores too).
 *
 * Exit codes: 0 success, 1 data or validation error, 2 usage error.
 */

const USAGE = `manage-data — add, edit, and delete Models, Benchmarks, and Scores.

Usage:
  manage-data [options] add model     --json <Model JSON | @file>
  manage-data [options] add benchmark --json <Benchmark JSON | @file>
  manage-data [options] add score     --json <Score JSON | @file>
  manage-data [options] edit model     <id> --json <patch | @file>
  manage-data [options] edit benchmark <id> --json <patch | @file>
  manage-data [options] edit score     <modelId> <benchmarkId> <evaluationSetting> --json <patch | @file>
  manage-data [options] delete model     <id> [--cascade]
  manage-data [options] delete benchmark <id> [--cascade]
  manage-data [options] delete score     <modelId> <benchmarkId> <evaluationSetting>

Options:
  --data-dir <path>  Data directory to operate on (default: the workspace's
                     packages/data directory).
  --json <value>     JSON record for add, or a JSON patch object for edit.
                     A value starting with @ is read from that file. In an
                     edit patch, null removes an optional field
                     (licenseName, notes) and sets required nullable fields
                     (inputPricePer1M, outputPricePer1M,
                     referenceInferenceProvider) to null.
  --cascade          With "delete model" / "delete benchmark": also delete
                     the Scores that would be orphaned. Without it, such a
                     deletion is refused.
  -h, --help         Show this help.

Every mutation validates the whole dataset before anything is written:
invalid input exits non-zero and leaves every file unchanged. Scores are
identified by (modelId, benchmarkId, evaluationSetting); a pair that has
Scores needs exactly one Primary score at all times.

Exit codes: 0 success, 1 data or validation error, 2 usage error.
`;

interface ParsedArgs {
  dataDir: string;
  command: string | undefined;
  entity: string | undefined;
  positionals: string[];
  json: string | undefined;
  cascade: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {
    dataDir: DEFAULT_DATA_DIR,
    command: undefined,
    entity: undefined,
    positionals: [],
    json: undefined,
    cascade: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "--data-dir") {
      const value = argv[i + 1];
      if (value === undefined) {
        usageError("--data-dir requires a path", USAGE);
      }
      args.dataDir = path.resolve(value);
      i += 2;
      continue;
    }
    if (arg === "--json") {
      const value = argv[i + 1];
      if (value === undefined) {
        usageError("--json requires a JSON object or @file", USAGE);
      }
      args.json = value;
      i += 2;
      continue;
    }
    if (arg === "--cascade") {
      args.cascade = true;
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      usageError(`unknown option: ${arg}`, USAGE);
    }
    if (args.command === undefined) {
      args.command = arg;
    } else if (args.entity === undefined) {
      args.entity = arg;
    } else {
      args.positionals.push(arg);
    }
    i += 1;
  }
  return args;
}

function readJsonArg(value: string): Record<string, unknown> {
  const text = value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    usageError(
      `--json is not valid JSON (${error instanceof SyntaxError ? error.message : String(error)})`,
      USAGE,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    usageError("--json must be a JSON object", USAGE);
  }
  return parsed as Record<string, unknown>;
}

/** Edit-patch semantics: null removes optional fields, otherwise assigns. */
const NULLABLE_OPTIONAL_FIELDS = new Set(["licenseName", "notes"]);

function applyPatch(record: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && NULLABLE_OPTIONAL_FIELDS.has(key)) {
      delete record[key];
    } else {
      record[key] = value;
    }
  }
}

function findIndexById(records: Record<string, unknown>[], id: string): number {
  return records.findIndex((record) => record.id === id);
}

function findScoreIndex(
  dataset: MutableDataset,
  modelId: unknown,
  benchmarkId: unknown,
  evaluationSetting: unknown,
): number {
  return dataset.scores.findIndex(
    (score) =>
      score.modelId === modelId &&
      score.benchmarkId === benchmarkId &&
      score.evaluationSetting === evaluationSetting,
  );
}

function describeScore(modelId: unknown, benchmarkId: unknown, evaluationSetting: unknown): string {
  return `Model "${String(modelId)}" on Benchmark "${String(benchmarkId)}", Evaluation setting "${String(evaluationSetting)}"`;
}

function addModel(dataDir: string, record: Record<string, unknown>): void {
  const dataset = loadForMutation(dataDir);
  if (typeof record.id === "string" && dataset.models.some((model) => model.id === record.id)) {
    fail(`Model "${record.id}" already exists; use "edit model ${record.id}" to change it`);
  }
  dataset.models.push(record);
  saveIfValid(
    dataDir,
    dataset,
    ["models"],
    `added Model "${String(record.id)}" to models.json`,
  );
}

function addBenchmark(dataDir: string, record: Record<string, unknown>): void {
  const dataset = loadForMutation(dataDir);
  if (
    typeof record.id === "string" &&
    dataset.benchmarks.some((benchmark) => benchmark.id === record.id)
  ) {
    fail(`Benchmark "${record.id}" already exists; use "edit benchmark ${record.id}" to change it`);
  }
  dataset.benchmarks.push(record);
  saveIfValid(
    dataDir,
    dataset,
    ["benchmarks"],
    `added Benchmark "${String(record.id)}" to benchmarks.json`,
  );
}

function addScore(dataDir: string, record: Record<string, unknown>): void {
  const dataset = loadForMutation(dataDir);
  if (findScoreIndex(dataset, record.modelId, record.benchmarkId, record.evaluationSetting) !== -1) {
    fail(
      `Score for ${describeScore(record.modelId, record.benchmarkId, record.evaluationSetting)} already exists; use "edit score <modelId> <benchmarkId> <evaluationSetting>" to change it`,
    );
  }
  dataset.scores.push(record);
  saveIfValid(
    dataDir,
    dataset,
    ["scores"],
    `added Score for ${describeScore(record.modelId, record.benchmarkId, record.evaluationSetting)} to scores.json`,
  );
}

function editModel(dataDir: string, id: string, patch: Record<string, unknown>): void {
  const dataset = loadForMutation(dataDir);
  const index = findIndexById(dataset.models, id);
  const model = index === -1 ? undefined : dataset.models[index];
  if (!model) {
    fail(`Model "${id}" not found in models.json`);
  }
  applyPatch(model, patch);
  saveIfValid(dataDir, dataset, ["models"], `edited Model "${id}" in models.json`);
}

function editBenchmark(dataDir: string, id: string, patch: Record<string, unknown>): void {
  const dataset = loadForMutation(dataDir);
  const index = findIndexById(dataset.benchmarks, id);
  const benchmark = index === -1 ? undefined : dataset.benchmarks[index];
  if (!benchmark) {
    fail(`Benchmark "${id}" not found in benchmarks.json`);
  }
  applyPatch(benchmark, patch);
  saveIfValid(dataDir, dataset, ["benchmarks"], `edited Benchmark "${id}" in benchmarks.json`);
}

function editScore(
  dataDir: string,
  modelId: string,
  benchmarkId: string,
  evaluationSetting: string,
  patch: Record<string, unknown>,
): void {
  const dataset = loadForMutation(dataDir);
  const index = findScoreIndex(dataset, modelId, benchmarkId, evaluationSetting);
  const score = index === -1 ? undefined : dataset.scores[index];
  if (!score) {
    fail(
      `Score for ${describeScore(modelId, benchmarkId, evaluationSetting)} not found in scores.json`,
    );
  }
  applyPatch(score, patch);
  saveIfValid(
    dataDir,
    dataset,
    ["scores"],
    `edited Score for ${describeScore(modelId, benchmarkId, evaluationSetting)} in scores.json`,
  );
}

function deleteModel(dataDir: string, id: string, cascade: boolean): void {
  const dataset = loadForMutation(dataDir);
  const index = findIndexById(dataset.models, id);
  if (index === -1) {
    fail(`Model "${id}" not found in models.json`);
  }
  const orphanedScores = dataset.scores.filter((score) => score.modelId === id);
  if (orphanedScores.length > 0 && !cascade) {
    fail(
      `refusing to delete Model "${id}": ${orphanedScores.length} Score(s) reference it and would be orphaned; pass --cascade to delete them too`,
    );
  }
  dataset.models.splice(index, 1);
  const changedKeys: DatasetKey[] = ["models"];
  if (orphanedScores.length > 0) {
    dataset.scores = dataset.scores.filter((score) => score.modelId !== id);
    changedKeys.push("scores");
  }
  saveIfValid(
    dataDir,
    dataset,
    changedKeys,
    orphanedScores.length > 0
      ? `deleted Model "${id}" and its ${orphanedScores.length} Score(s)`
      : `deleted Model "${id}"`,
  );
}

function deleteBenchmark(dataDir: string, id: string, cascade: boolean): void {
  const dataset = loadForMutation(dataDir);
  const index = findIndexById(dataset.benchmarks, id);
  if (index === -1) {
    fail(`Benchmark "${id}" not found in benchmarks.json`);
  }
  const orphanedScores = dataset.scores.filter((score) => score.benchmarkId === id);
  if (orphanedScores.length > 0 && !cascade) {
    fail(
      `refusing to delete Benchmark "${id}": ${orphanedScores.length} Score(s) reference it and would be orphaned; pass --cascade to delete them too`,
    );
  }
  dataset.benchmarks.splice(index, 1);
  const changedKeys: DatasetKey[] = ["benchmarks"];
  if (orphanedScores.length > 0) {
    dataset.scores = dataset.scores.filter((score) => score.benchmarkId !== id);
    changedKeys.push("scores");
  }
  saveIfValid(
    dataDir,
    dataset,
    changedKeys,
    orphanedScores.length > 0
      ? `deleted Benchmark "${id}" and its ${orphanedScores.length} Score(s)`
      : `deleted Benchmark "${id}"`,
  );
}

function deleteScore(
  dataDir: string,
  modelId: string,
  benchmarkId: string,
  evaluationSetting: string,
): void {
  const dataset = loadForMutation(dataDir);
  const index = findScoreIndex(dataset, modelId, benchmarkId, evaluationSetting);
  if (index === -1) {
    fail(
      `Score for ${describeScore(modelId, benchmarkId, evaluationSetting)} not found in scores.json`,
    );
  }
  dataset.scores.splice(index, 1);
  saveIfValid(
    dataDir,
    dataset,
    ["scores"],
    `deleted Score for ${describeScore(modelId, benchmarkId, evaluationSetting)} from scores.json`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.command === undefined) {
    usageError("missing command", USAGE);
  }
  if (args.command === "help") {
    console.log(USAGE);
    return;
  }
  if (args.command !== "add" && args.command !== "edit" && args.command !== "delete") {
    usageError(`unknown command: ${args.command}`, USAGE);
  }
  const command = args.command;

  if (args.entity === undefined) {
    usageError(`missing entity (model, benchmark, or score) after "${command}"`, USAGE);
  }
  if (args.entity !== "model" && args.entity !== "benchmark" && args.entity !== "score") {
    usageError(`unknown entity: ${args.entity} (expected model, benchmark, or score)`, USAGE);
  }
  const entity = args.entity;

  if (args.cascade && !(command === "delete" && (entity === "model" || entity === "benchmark"))) {
    usageError("--cascade is only valid with delete model / delete benchmark", USAGE);
  }

  const needsJson = command === "add" || command === "edit";
  if (needsJson && args.json === undefined) {
    usageError(`${command} ${entity} requires --json`, USAGE);
  }
  const record = args.json === undefined ? undefined : readJsonArg(args.json);

  const expectedPositionals =
    entity === "score" ? (command === "add" ? 0 : 3) : command === "add" ? 0 : 1;
  if (args.positionals.length !== expectedPositionals) {
    usageError(
      `${command} ${entity} expects ${expectedPositionals} positional argument(s) after the entity, received ${args.positionals.length}`,
      USAGE,
    );
  }

  if (command === "add") {
    if (record === undefined) {
      usageError(`add ${entity} requires --json`, USAGE);
    }
    if (entity === "model") {
      addModel(args.dataDir, record);
    } else if (entity === "benchmark") {
      addBenchmark(args.dataDir, record);
    } else {
      addScore(args.dataDir, record);
    }
    return;
  }

  if (command === "edit") {
    if (record === undefined) {
      usageError(`edit ${entity} requires --json`, USAGE);
    }
    if (entity === "model") {
      editModel(args.dataDir, String(args.positionals[0]), record);
    } else if (entity === "benchmark") {
      editBenchmark(args.dataDir, String(args.positionals[0]), record);
    } else {
      editScore(
        args.dataDir,
        String(args.positionals[0]),
        String(args.positionals[1]),
        String(args.positionals[2]),
        record,
      );
    }
    return;
  }

  // delete
  if (entity === "model") {
    deleteModel(args.dataDir, String(args.positionals[0]), args.cascade);
  } else if (entity === "benchmark") {
    deleteBenchmark(args.dataDir, String(args.positionals[0]), args.cascade);
  } else {
    deleteScore(
      args.dataDir,
      String(args.positionals[0]),
      String(args.positionals[1]),
      String(args.positionals[2]),
    );
  }
}

main();
