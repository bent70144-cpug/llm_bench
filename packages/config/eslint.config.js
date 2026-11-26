import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint 9 flat config for every LLM Bench package.
 *
 * Each package has its own `eslint.config.js` that re-exports (or extends)
 * this base. Globals for both Node and browser are included because the
 * workspace mixes Node-side packages (tools, scoring) with the web app.
 */
export const baseConfig = [
  {
    ignores: ["**/dist/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];

export default baseConfig;
