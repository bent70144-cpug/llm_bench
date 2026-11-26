import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readMutableDataset,
  validateDataset,
  writeDatasetFile,
  type DatasetKey,
  type MutableDataset,
} from "./dataset";

/**
 * Process-level helpers shared by the tools commands (validate-data,
 * manage-data, import-scores): the shared argument loop, usage errors,
 * failure exits, and the validate-before-write mutation gate.
 */

/** The real data package, when --data-dir is not given. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../packages/data", import.meta.url));

/** The options every tools command shares, parsed out of its argv. */
export interface CommonArgs {
  /** The data directory: the --data-dir value resolved, or the default. */
  dataDir: string;
  /** Whether -h / --help was given. */
  help: boolean;
  /** The remaining arguments, with the common options removed. */
  rest: readonly string[];
}

/**
 * Parses the options every tools command shares — `--data-dir <path>` and
 * `-h` / `--help` — and returns them beside the remaining arguments, so
 * each command's own loop handles only its specific options and
 * positionals. A missing --data-dir value is a usage error (exit 2)
 * against the given usage text; what the help flag then does stays each
 * command's own decision (all print their usage and exit 0).
 */
export function parseCommonArgs(argv: readonly string[], usage: string): CommonArgs {
  const rest: string[] = [];
  let dataDir = DEFAULT_DATA_DIR;
  let help = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "--data-dir") {
      const value = argv[i + 1];
      if (value === undefined) {
        usageError("--data-dir requires a path", usage);
      }
      dataDir = path.resolve(value);
      i += 2;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      i += 1;
      continue;
    }
    rest.push(arg);
    i += 1;
  }
  return { dataDir, help, rest };
}

export function usageError(message: string, usage: string): never {
  console.error(`error: ${message}`);
  console.error(usage);
  process.exit(2);
}

export function fail(...problems: string[]): never {
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  process.exit(1);
}

/**
 * Load the five data files in a mutable form. Exits 1 when the directory
 * cannot be read at all (missing files, invalid JSON, wrong shapes) — a
 * mutation must never run on unreadable data.
 */
export function loadForMutation(dataDir: string): MutableDataset {
  const { dataset, errors } = readMutableDataset(dataDir);
  if (!dataset || errors.length > 0) {
    fail(...errors);
  }
  return dataset;
}

/**
 * The mutation gate: validate the whole in-memory dataset, and only write
 * the changed files when it is fully valid. On any validation problem,
 * print every error, state that nothing was written, and exit 1.
 */
export function saveIfValid(
  dataDir: string,
  dataset: MutableDataset,
  changedKeys: readonly DatasetKey[],
  successMessage: string,
): void {
  const errors = validateDataset(dataset);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
    console.error("no files were written");
    process.exit(1);
  }
  for (const key of changedKeys) {
    writeDatasetFile(dataDir, key, dataset[key]);
  }
  console.log(successMessage);
}
