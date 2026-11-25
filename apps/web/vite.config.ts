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
});
