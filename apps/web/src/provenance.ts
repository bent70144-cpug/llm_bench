import type { Score } from "@llm-bench/schema";

/**
 * Shared provenance vocabulary for the Score provenance UI (ticket 07).
 *
 * The verified-semantics sentence below is the definition
 * docs/DECISIONS.md and the glossary mandate: `verified: true` means the
 * data owner checked the value and Evaluation setting against the linked
 * source URL — not independent reproduction. It is a fixed definition of
 * the flag (like the glossary itself), rendered wherever a verified status
 * appears; every Score-specific string comes from the data package.
 */

export const VERIFIED_EXPLANATION =
  "the data owner checked the value and Evaluation setting against the linked Source URL, not an independent reproduction";

/** The tooltip line stating a Score's verified status with its exact meaning. */
export function verifiedStatusLine(score: Score): string {
  return score.verified
    ? `Verified: yes — ${VERIFIED_EXPLANATION}.`
    : "Not verified — the value and Evaluation setting have not been checked against the linked Source URL.";
}

/** The host of a source URL, shown as the visible link text. */
export function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
