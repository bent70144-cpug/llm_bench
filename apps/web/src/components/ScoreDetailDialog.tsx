import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { Benchmark, Model, Score } from "@llm-bench/schema";
import { ScorePairDetail } from "./ScorePairDetail";

/**
 * The leaderboard's Score details panel (ticket 07): a modal dialog over
 * the table that mounts the reusable ScorePairDetail for one Model and
 * Benchmark pair. It opens from a score cell's details button (mouse or
 * keyboard), closes on Escape, the Close button, or a backdrop click,
 * keeps Tab inside while open, and returns focus to the trigger on close.
 *
 * Ticket 09 does not reuse the dialog — it mounts ScorePairDetail inline on
 * the Model page — so all dialog behaviour lives here.
 */

interface ScoreDetailDialogProps {
  model: Model;
  benchmark: Benchmark;
  /** All Scores; ScorePairDetail splits this pair's Scores via scoresForPair. */
  scores: readonly Score[];
  onClose: () => void;
}

export function ScoreDetailDialog({ model, benchmark, scores, onClose }: ScoreDetailDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const titleId = useId();

  // Focus moves into the dialog when it opens and back to the trigger
  // (the score cell's details button) when it closes.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      const element = previouslyFocused.current;
      if (element instanceof HTMLElement) element.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // The dialog is modal, so Tab stays inside it.
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="score-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>
          Score details: {model.name} on {benchmark.name}
        </h2>
        <button type="button" className="dialog-close" onClick={onClose}>
          Close
        </button>
        <ScorePairDetail model={model} benchmark={benchmark} scores={scores} />
      </div>
    </div>,
    document.body,
  );
}
