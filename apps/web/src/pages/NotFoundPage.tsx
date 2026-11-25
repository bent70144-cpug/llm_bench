import { BackLink } from "../BackLink";

/**
 * The generic not-found page for every path that is not a route — including
 * the `/models/:id` and `/compare` routes that later tickets will own.
 */
export function NotFoundPage() {
  return (
    <>
      <BackLink />
      <h1>Page not found</h1>
      <p>
        This page does not exist. Every Benchmark has a page at{" "}
        <code>/benchmarks/&lt;id&gt;</code>, and the leaderboard is at the root.
      </p>
    </>
  );
}
