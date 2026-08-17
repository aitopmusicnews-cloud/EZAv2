import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// happy-dom globally — the web store test needs localStorage for zustand's
// persist middleware, and the api / shared tests don't care either way.
// Resolve @mvs/shared to source for tests so a clean checkout can run `pnpm test`
// before workspace build artifacts exist.
export default defineConfig({
  resolve: {
    alias: {
      "@mvs/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
    ],
    exclude: [
      "**/*probe*",
      "**/node_modules/**",
      "**/dist/**",
      "**/.terragrunt-cache/**",
    ],
  },
});
