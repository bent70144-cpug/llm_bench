import type { CSSProperties } from "react";

/**
 * Shared chart/tooltip presentation helpers for the web app: the portal
 * tooltip placement used by the leaderboard's Score tooltip (ticket 07) and
 * the price/performance chart's point tooltip (ticket 11), and the
 * one-decimal number form every displayed Average, Weighted Average, and
 * price-basis value uses.
 */

/** The gap a portal tooltip keeps from its anchor and from the viewport edges. */
const TOOLTIP_GAP = 8;

/** A tooltip flips below its anchor when less than this much room is above it. */
const TOOLTIP_FLIP_THRESHOLD = 240;

/**
 * Fixed-position placement for a portal tooltip against an element's
 * bounding box: above the anchor when there is room for it, below
 * otherwise, horizontally clamped to the viewport so it never runs off
 * screen. `estimatedWidth` is the widest the tooltip can get (its
 * right-edge clamp); `leftOffset` shifts the tooltip's left edge relative
 * to the anchor's (0 aligns them).
 */
export function portalTooltipStyle(
  rect: DOMRect,
  estimatedWidth: number,
  leftOffset = 0,
): CSSProperties {
  const above = rect.top > TOOLTIP_FLIP_THRESHOLD;
  return {
    position: "fixed",
    left: Math.min(
      Math.max(TOOLTIP_GAP, rect.left + leftOffset),
      Math.max(TOOLTIP_GAP, window.innerWidth - estimatedWidth),
    ),
    top: above ? rect.top - TOOLTIP_GAP : rect.bottom + TOOLTIP_GAP,
    transform: above ? "translateY(-100%)" : undefined,
  };
}

/** One-decimal display form, trailing zeros dropped (97.0 → "97"). */
export function formatOneDecimal(value: number): string {
  return Number(value.toFixed(1)).toString();
}
