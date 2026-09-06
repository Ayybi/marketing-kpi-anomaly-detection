import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Integration tests hit a real MongoDB (a throwaway test DB); give them room and avoid
    // cross-file DB races by disabling file-level parallelism.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
})
