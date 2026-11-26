import { type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Score } from "@llm-bench/schema";
import { portalTooltipStyle } from "../chart-utils";
import { verifiedStatusLine } from "../provenance";

/**
 * The provenance tooltip for one leaderboard score cell (ticket 07):
 * Source type, Evaluation setting, publishedDate, retrievedDate, and the
 * verified status with its exact semantics, plus a pointer to the Score
 * details panel. It is rendered into a portal and positioned from the
 * score cell's bounding box, so the table's scroll container can never
 * clip it. It appears on hover and on keyboard focus; the cell's link and
 * details button carry aria-describedby pointing at this element, so the
 * provenance reaches screen readers too.
 */

interface ProvenanceTooltipProps {
  /** The id the score cell's aria-describedby points at. */
  id: string;
  /** The element the tooltip is positioned against (the score cell). */
  anchor: HTMLElement;
  score: Score;
}

export function ProvenanceTooltip({ id, anchor, score }: ProvenanceTooltipProps) {
  const rect = anchor.getBoundingClientRect();
  const style: CSSProperties = portalTooltipStyle(rect, 360);

  return createPortal(
    <div id={id} role="tooltip" className="score-tooltip" style={style}>
      <p>
        <strong>Source type:</strong> {score.sourceType}
      </p>
      <p>
        <strong>Evaluation setting:</strong> {score.evaluationSetting}
      </p>
      <p>
        <strong>publishedDate:</strong> {score.publishedDate}
      </p>
      <p>
        <strong>retrievedDate:</strong> {score.retrievedDate}
      </p>
      <p>{verifiedStatusLine(score)}</p>
      <p className="tooltip-hint">
        The Score details control beside this Score lists any alternate Evaluation settings.
      </p>
    </div>,
    document.body,
  );
}
