import { parseCommonArgs, usageError } from "./lib/cli";
import { auditDataDir } from "./lib/audit";
import { validateDataDir } from "./lib/dataset";

/**
 * validate-data — structural gate (and, with --audit, the pre-launch data
 * audit) for the @llm-bench/data package.
 *
 * Usage: tsx src/validate-data.ts [--data-dir <path>] [--audit] [-h, --help]
 *
 * Defaults to the workspace's packages/data directory. Exit codes:
 *   0 — data is valid
 *   1 — data is invalid (all problems are printed)
 *   2 — usage error
 *
 * --audit runs the zero-placeholder pre-launch pass from
 * docs/pre-launch-audit.md on top of the structural rules: it additionally
 * fails on any unverified Score, any placeholder-looking value, any
 * reserved/stub source host, any $0 price, and any stub id or name. Plain
 * mode (what `pnpm validate` and CI run) is unchanged — the audit is the
 * launch gate, not the authoring gate.
 */

const USAGE = "usage: validate-data [--data-dir <path>] [--audit] [-h, --help]";

interface CliArgs {
  dataDir: string;
  audit: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const { dataDir, help, rest } = parseCommonArgs(argv, USAGE);
  const args: CliArgs = { dataDir, audit: false, help };

  for (const arg of rest) {
    if (arg === "--audit") {
      args.audit = true;
      continue;
    }
    usageError(`unknown argument: ${arg}`, USAGE);
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.audit) {
    const { errors, summary } = auditDataDir(args.dataDir);
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`error: ${error}`);
      }
      console.error(`audit failed: ${errors.length} problem(s) found in ${args.dataDir}`);
      process.exit(1);
    }
    console.log(summary);
    return;
  }

  const errors = validateDataDir(args.dataDir);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
    console.error(`invalid: ${errors.length} problem(s) found in ${args.dataDir}`);
    process.exit(1);
  }

  console.log(`valid: ${args.dataDir}`);
}

main();
