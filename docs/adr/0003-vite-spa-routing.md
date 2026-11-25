# Vite SPA routing instead of Next.js static export

`apps/web` uses Vite with client-side routing and a catch-all SPA rewrite in `vercel.json` for `/models/:id`, `/benchmarks/:id`, and `/compare`; selection, weights, and compared models live in URL query parameters. All data is bundled from `@llm-bench/data`, so pre-rendered HTML per URL adds build complexity without a stated SEO requirement. The trade-off is weaker crawler-visible metadata, accepted for v1.
