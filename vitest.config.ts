import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Testcontainers spins up real Postgres; give it room and isolate from
    // the app's vitest projects by running this package standalone.
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "threads",
  },
});
