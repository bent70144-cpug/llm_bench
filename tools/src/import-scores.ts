import { readFileSync } from "node:fs";
import path from "node:path";
import {
  fail,
  loadForMutation,
  parseCommonArgs,
  saveIfValid,
  usageError,
} from "./lib/cli";

/**
 * import-scores — bulk-import Scores from a CSV file into the
 * @llm-bench/data package (ticket 02).
 *
 * A row whose (modelId, benchmarkId, evaluationSetting) triple already
 * exists replaces that Score in place (corrections replace; ADR-0002);
 * other rows are appended. Every row is validated before anything is
 * written: any problem exits non-zero and writes nothing (all-or-nothing).
 *
 * Exit codes: 0 success, 1 data or validation error, 2 usage error.
 */

const USAGE = `import-scores — bulk-import Scores from a CSV file.

Usage: import-scores [--data-dir <path>] <csv-file>

The CSV file must have a header row. Required columns (order-free; extra
columns are ignored):

  modelId, benchmarkId, value, evaluationSetting, sourceType, sourceUrl,
  publishedDate, retrievedDate, verified, isPrimary

Types: value is a number 0-100; verified and isPrimary are true/false;
evaluationSetting must already exist in evaluation-settings.json; modelId
and benchmarkId must reference existing records. A row whose (modelId,
benchmarkId, evaluationSetting) triple already exists replaces that Score
in place; other rows are appended. Later rows replace earlier rows with
the same triple.

Every row is validated before anything is written: any bad row exits
non-zero and writes nothing.

Options:
  --data-dir <path>  Data directory to import into (default: the
                     workspace's packages/data directory).
  -h, --help         Show this help.

Exit codes: 0 success, 1 data or validation error, 2 usage error.
`;

const REQUIRED_COLUMNS = [
  "modelId",
  "benchmarkId",
  "value",
  "evaluationSetting",
  "sourceType",
  "sourceUrl",
  "publishedDate",
  "retrievedDate",
  "verified",
  "isPrimary",
] as const;

interface CliArgs {
  dataDir: string;
  help: boolean;
  csvFile: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const { dataDir, help, rest } = parseCommonArgs(argv, USAGE);
  const args: CliArgs = { dataDir, help, csvFile: undefined };

  for (const arg of rest) {
    if (arg.startsWith("--")) {
      usageError(`unknown option: ${arg}`, USAGE);
    }
    if (args.csvFile !== undefined) {
      usageError(`unexpected extra argument: ${arg}`, USAGE);
    }
    args.csvFile = path.resolve(arg);
  }
  return args;
}

/**
 * Minimal RFC-4180 CSV parser: quoted fields, escaped double quotes, commas
 * inside quotes, CRLF and LF line endings, and a UTF-8 BOM.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  if (text.startsWith("\uFEFF")) {
    i = 1;
  }

  while (i < text.length) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines.
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

function parseBoolean(value: string, rowNumber: number, column: string): boolean | string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return `row ${rowNumber}: ${column} "${value}" must be true or false`;
}

function coerceRow(
  row: readonly string[],
  columns: ReadonlyMap<string, number>,
  rowNumber: number,
): { score?: Record<string, unknown>; error?: string } {
  const score: Record<string, unknown> = {};

  for (const column of REQUIRED_COLUMNS) {
    const index = columns.get(column);
    if (index === undefined) {
      // The header check below reports missing columns; be defensive here.
      return { error: `missing required column "${column}"` };
    }
    const cell = row[index];
    if (cell === undefined) {
      return { error: `row ${rowNumber}: has ${row.length} fields, expected ${columns.size}` };
    }
    if (column === "value") {
      const numeric = Number(cell);
      if (cell.trim() === "" || !Number.isFinite(numeric)) {
        return { error: `row ${rowNumber}: value "${cell}" is not a number` };
      }
      score.value = numeric;
    } else if (column === "verified" || column === "isPrimary") {
      const boolean = parseBoolean(cell, rowNumber, column);
      if (typeof boolean === "string") {
        return { error: boolean };
      }
      score[column] = boolean;
    } else {
      score[column] = cell;
    }
  }

  return { score };
}

function scoreTripleKey(score: Record<string, unknown>): string {
  return `${String(score.modelId)}\u0000${String(score.benchmarkId)}\u0000${String(score.evaluationSetting)}`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.csvFile === undefined) {
    usageError("missing <csv-file>", USAGE);
  }

  let text: string;
  try {
    text = readFileSync(args.csvFile, "utf8");
  } catch (error) {
    fail(`cannot read CSV file ${args.csvFile} (${error instanceof Error ? error.message : String(error)})`);
  }

  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) {
    fail(`${args.csvFile}: CSV file is empty (a header row is required)`);
  }

  const columns = new Map<string, number>();
  header.forEach((name, index) => {
    if (!columns.has(name)) {
      columns.set(name, index);
    }
  });
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missingColumns.length > 0) {
    fail(
      ...missingColumns.map((column) => `missing required column "${column}" in the header row`),
    );
  }

  const dataset = loadForMutation(args.dataDir);

  const rowErrors: string[] = [];
  const parsedScores: Record<string, unknown>[] = [];
  rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) {
      return; // header
    }
    const rowNumber = rowIndex + 1; // human row number, header is row 1
    if (row.length !== columns.size) {
      rowErrors.push(`row ${rowNumber}: has ${row.length} fields, expected ${columns.size}`);
      return;
    }
    const { score, error } = coerceRow(row, columns, rowNumber);
    if (error) {
      rowErrors.push(error);
      return;
    }
    if (score) {
      parsedScores.push(score);
    }
  });

  if (rowErrors.length > 0) {
    console.error(`error: ${args.csvFile}: ${rowErrors.length} row(s) failed to parse:`);
    for (const rowError of rowErrors) {
      console.error(`error: ${rowError}`);
    }
    console.error("no files were written");
    process.exit(1);
  }

  // Upsert: a known triple replaces the existing Score in place.
  let added = 0;
  let updated = 0;
  const indexByTriple = new Map<string, number>(
    dataset.scores.map((score, index) => [scoreTripleKey(score), index]),
  );
  for (const score of parsedScores) {
    const key = scoreTripleKey(score);
    const existingIndex = indexByTriple.get(key);
    if (existingIndex === undefined) {
      dataset.scores.push(score);
      indexByTriple.set(key, dataset.scores.length - 1);
      added += 1;
    } else {
      dataset.scores[existingIndex] = score;
      updated += 1;
    }
  }

  saveIfValid(
    args.dataDir,
    dataset,
    ["scores"],
    `imported ${parsedScores.length} Score(s) from ${args.csvFile}: ${added} added, ${updated} updated`,
  );
}

main();
