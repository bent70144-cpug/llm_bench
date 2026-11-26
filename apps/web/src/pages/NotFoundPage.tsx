import { BackLink } from "../BackLink";

/**
 * The generic not-found page for every path that is not a route.
 */
export function NotFoundPage() {
  return (
    <>
      <BackLink />
      <h1>Page not found</h1>
      <p>
        This page does not exist. Every Benchmark has a page at{" "}
        <code>/benchmarks/&lt;id&gt;</code>, every Model at <code>/models/&lt;id&gt;</code>, the
        compare view is at <code>/compare</code>, and the leaderboard is at the root.
      </p>
    </>
  );
}
