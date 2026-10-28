import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const contracts = fileURLToPath(new URL("../supabase/functions/_shared/contracts.ts", import.meta.url));

export default defineConfig({
  // GitHub Pages serves from /<repo>/ — set VITE_BASE_PATH=/<repo>/ when building for Pages.
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  resolve: { alias: { "@contracts": contracts } },
  server: { fs: { allow: [".."] } },
  test: { include: ["tests/**/*.test.ts"] },
});
