/**
 * Pure route logic for the LLM Bench SPA (ADR-0003: Vite with client-side
 * routing; a catch-all rewrite serves index.html so direct links work).
 *
 * The route shape is `/` (the leaderboard), `/benchmarks/:id` (one page per
 * Benchmark, created automatically by the data package), `/models/:id` (one
 * page per Model, likewise created automatically by the data package), and
 * a generic not-found page for everything else. Routes that later tickets
 * will own (`/compare`) are deliberately NOT special-cased: they fall
 * through to the generic not-found page until they are built.
 *
 * This module is free of React and DOM APIs on purpose: it is the route
 * table as data, unit-testable anywhere, and the only thing later tickets
 * need to extend when they add pages.
 */

/** The leaderboard lives at the root. */
export const LEADERBOARD_PATH = "/";

const BENCHMARK_ROUTE_PREFIX = "/benchmarks/";
const MODEL_ROUTE_PREFIX = "/models/";

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

/**
 * A Model detail page. The id comes straight from the URL; whether a Model
 * with that id exists is a data lookup the page itself performs (unknown
 * ids get the page's own not-found view).
 */
export interface ModelRoute {
  page: "model";
  modelId: string;
}

/** The generic not-found page for every path that is not a route. */
export interface NotFoundRoute {
  page: "not-found";
}

/** The one resolved route for a pathname. */
export type Route =
  | LeaderboardRoute
  | BenchmarkRoute
  | ModelRoute
  | NotFoundRoute;

/** The URL of one Benchmark's detail page. */
export function benchmarkPath(benchmarkId: string): string {
  return `${BENCHMARK_ROUTE_PREFIX}${benchmarkId}`;
}

/** The URL of one Model's detail page. */
export function modelPath(modelId: string): string {
  return `${MODEL_ROUTE_PREFIX}${modelId}`;
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

  const detailId = (prefix: string): string | null => {
    if (!normalized.startsWith(prefix)) return null;
    const rawId = normalized.slice(prefix.length);
    if (rawId === "" || rawId.includes("/")) return null;
    try {
      return decodeURIComponent(rawId);
    } catch {
      // Malformed percent-escapes (e.g. "/models/%") are not a route.
      return null;
    }
  };

  const benchmarkId = detailId(BENCHMARK_ROUTE_PREFIX);
  if (benchmarkId !== null) {
    return { page: "benchmark", benchmarkId };
  }

  const modelId = detailId(MODEL_ROUTE_PREFIX);
  if (modelId !== null) {
    return { page: "model", modelId };
  }

  return { page: "not-found" };
}
