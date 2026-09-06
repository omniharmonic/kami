import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@kami/needs": fileURLToPath(new URL("../../packages/needs/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { SKIP_ENV_VALIDATION: "1", NODE_ENV: "test" },
  },
});
