import { fileURLToPath } from "node:url";
import {
  readMutableDataset,
  validateDataset,
  writeDatasetFile,
  type DatasetKey,
  type MutableDataset,
} from "./dataset";

/**
 * Process-level helpers shared by the mutating tools commands
 * (manage-data, import-scores): usage errors, failure exits, and the
 * validate-before-write mutation gate.
 */

/** The real data package, when --data-dir is not given. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../packages/data", import.meta.url));

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
