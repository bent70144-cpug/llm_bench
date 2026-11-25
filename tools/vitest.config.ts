import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The end-to-end tests (leaderboard-e2e, benchmark-pages-e2e) run
    // `pnpm build`, which writes into the shared apps/web/dist. Test files
    // must therefore run one at a time — concurrent files would race on the
    // build output.
    fileParallelism: false,
  },
});
