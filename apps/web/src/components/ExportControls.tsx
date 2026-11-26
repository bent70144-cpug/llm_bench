import type { Model } from "@llm-bench/schema";
import { benchmarks, models, scores } from "@llm-bench/data";
import {
  buildFullDatasetExport,
  buildViewExport,
  exportFilename,
  viewExportToCsv,
  type LeaderboardUrlState,
} from "@llm-bench/scoring";

/**
 * The export controls (ticket 12): three labelled, keyboard-operable buttons
 * that download the current view (CSV or JSON) and the full raw dataset
 * (JSON). Everything is generated at click time from the data package plus
 * the leaderboard's current rows and view state, so an export always
 * reflects the active Benchmark selection, weights, filters, and sort —
 * never hardcoded columns. Downloads go through blob URLs; no server is
 * involved, per the static-hosting constraint.
 */

/** Downloads `content` as a named file via a temporary blob URL. */
function downloadFile(filename: string, content: string, mediaType: string): void {
  const blob = new Blob([content], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // The download captures the blob when the click is processed; revoke the
  // URL shortly after so it never leaks.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportControls({
  rows,
  viewState,
}: {
  /** The leaderboard's current filtered, sorted rows, in display order. */
  rows: readonly Model[];
  /** The active view state: selection, weights, sort, and filters. */
  viewState: LeaderboardUrlState;
}) {
  function exportViewAsCsv(): void {
    const exportedAt = new Date().toISOString();
    const view = buildViewExport({ rows, benchmarks, scores, state: viewState, exportedAt });
    downloadFile(
      exportFilename("view-csv", exportedAt),
      viewExportToCsv(view),
      "text/csv;charset=utf-8",
    );
  }

  function exportViewAsJson(): void {
    const exportedAt = new Date().toISOString();
    const view = buildViewExport({ rows, benchmarks, scores, state: viewState, exportedAt });
    downloadFile(
      exportFilename("view-json", exportedAt),
      JSON.stringify(view, null, 2),
      "application/json",
    );
  }

  function exportDatasetAsJson(): void {
    const exportedAt = new Date().toISOString();
    const dataset = buildFullDatasetExport({ models, benchmarks, scores, exportedAt });
    downloadFile(
      exportFilename("dataset-json", exportedAt),
      JSON.stringify(dataset, null, 2),
      "application/json",
    );
  }

  return (
    <section className="export-controls">
      <h2>Exports</h2>
      <p className="export-note">
        Download the current view — the filtered and sorted rows with one column per selected
        Benchmark (Primary scores with their Source type, source URL, publishedDate, and
        retrievedDate) and the active aggregate (Average, or Weighted Average when weights are
        set) with its Coverage — or the full raw dataset: every Model, Benchmark, and Score,
        including alternate Evaluation settings. Missing Scores export as &ldquo;n/a&rdquo;,
        never as zero.
      </p>
      <div className="export-buttons">
        <button
          type="button"
          onClick={exportViewAsCsv}
          aria-label="Export the current filtered and sorted view as CSV"
        >
          Export view (CSV)
        </button>
        <button
          type="button"
          onClick={exportViewAsJson}
          aria-label="Export the current filtered and sorted view as JSON"
        >
          Export view (JSON)
        </button>
        <button
          type="button"
          onClick={exportDatasetAsJson}
          aria-label="Export the full raw dataset as JSON, including all Scores and alternate Evaluation settings"
        >
          Export full dataset (JSON)
        </button>
      </div>
    </section>
  );
}
