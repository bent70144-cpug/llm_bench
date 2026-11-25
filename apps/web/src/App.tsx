import { useEffect, useRef } from "react";
import { benchmarks } from "@llm-bench/data";
import { useLocation } from "./router";
import { resolveRoute } from "./routes";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { BenchmarkPage } from "./pages/BenchmarkPage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * The app shell: resolves the current URL to a route (see routes.ts) and
 * renders the page. Each page renders exactly one h1 and its own sections;
 * the shell owns the <main> element so it can move keyboard focus to the
 * top of the page after client-side navigation, and it keeps the document
 * title in sync with the rendered page.
 */

/** The document title for the leaderboard (the index.html default). */
const SITE_TITLE = "LLM Bench";

function App() {
  const pathname = useLocation();
  const route = resolveRoute(pathname);

  const benchmark =
    route.page === "benchmark"
      ? benchmarks.find((candidate) => candidate.id === route.benchmarkId)
      : undefined;

  const title =
    route.page === "benchmark"
      ? (benchmark?.name ?? "Benchmark not found")
      : route.page === "not-found"
        ? "Page not found"
        : SITE_TITLE;

  const mainRef = useRef<HTMLElement | null>(null);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    document.title = title === SITE_TITLE ? SITE_TITLE : `${title} — ${SITE_TITLE}`;
  }, [title]);

  // After a client-side navigation the clicked link is gone, so focus would
  // fall back to the document body; move it to the page content instead.
  // The initial load keeps the browser's default focus behaviour.
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <main ref={mainRef} tabIndex={-1}>
      {route.page === "leaderboard" ? (
        <LeaderboardPage />
      ) : route.page === "benchmark" ? (
        <BenchmarkPage benchmarkId={route.benchmarkId} />
      ) : (
        <NotFoundPage />
      )}
    </main>
  );
}

export default App;
