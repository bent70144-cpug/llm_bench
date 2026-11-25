/**
 * Pure route logic for the LLM Bench SPA (ADR-0003: Vite with client-side
 * routing; a catch-all rewrite serves index.html so direct links work).
 *
 * The route shape is `/` (the leaderboard), `/benchmarks/:id` (one page per
 * Benchmark, created automatically by the data package), and a generic
 * not-found page for everything else. Routes that later tickets will own
 * (`/models/:id`, `/compare`) are deliberately NOT special-cased: they fall
 * through to the generic not-found page until they are built.
 *
 * This module is free of React and DOM APIs on purpose: it is the route
 * table as data, unit-testable anywhere, and the only thing later tickets
 * need to extend when they add pages.
 */

/** The leaderboard lives at the root. */
export const LEADERBOARD_PATH = "/";

const BENCHMARK_ROUTE_PREFIX = "/benchmarks/";

/** The leaderboard page. */
export interface LeaderboardRoute {
  page: "leaderboard";
}

/**
 * A Benchmark detail page. The id comes straight from the URL; whether a
 * Benchmark with that id exists is a data lookup the page itself performs
 * (unknown ids get the page's own not-found view).
 */
export interface BenchmarkRoute {
  page: "benchmark";
  benchmarkId: string;
}

/** The generic not-found page for every path that is not a route. */
export interface NotFoundRoute {
  page: "not-found";
}

/** The one resolved route for a pathname. */
export type Route = LeaderboardRoute | BenchmarkRoute | NotFoundRoute;

/** The URL of one Benchmark's detail page. */
export function benchmarkPath(benchmarkId: string): string {
  return `${BENCHMARK_ROUTE_PREFIX}${benchmarkId}`;
}

/**
 * Resolves a pathname to its route. A single trailing slash is tolerated
 * (`/benchmarks/mmlu-pro/` is the same route), and percent-escapes are
 * decoded so an encoded id still resolves; malformed escapes fall through
 * to not-found instead of throwing.
 */
export function resolveRoute(pathname: string): Route {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (normalized === LEADERBOARD_PATH) {
    return { page: "leaderboard" };
  }

  if (normalized.startsWith(BENCHMARK_ROUTE_PREFIX)) {
    const rawId = normalized.slice(BENCHMARK_ROUTE_PREFIX.length);
    if (rawId !== "" && !rawId.includes("/")) {
      try {
        return { page: "benchmark", benchmarkId: decodeURIComponent(rawId) };
      } catch {
        // Malformed percent-escapes (e.g. "/benchmarks/%") are not a route.
      }
    }
  }

  return { page: "not-found" };
}
