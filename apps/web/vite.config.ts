import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // ADR-0003 (SPA routing): with appType "spa" both the dev server and
  // `vite preview` fall back to index.html for paths like /benchmarks/<id>,
  // so direct navigation and refresh reach the client-side router.
  // Production hosting does the same through the catch-all rewrite in
  // vercel.json. This is Vite's default; it is spelled out because the
  // whole routing contract depends on it.
  appType: "spa",
  // ADR-0004 (no analytics / no third-party calls): Vite's modulepreload
  // polyfill is the only `fetch(` Vite would inject, and it exists solely
  // to load dynamic-import chunks on browsers without modulepreload
  // support. This app is a single chunk with no dynamic imports, so the
  // polyfill is unreachable dead code — dropping it leaves the shipped
  // JavaScript with zero network-call primitives (asserted by
  // tools/src/no-analytics.test.ts).
  build: { modulePreload: { polyfill: false } },
});
