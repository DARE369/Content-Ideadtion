import { defineConfig } from "vitest/config";

// Database tests need TEST_DATABASE_URL pointing at a throwaway Postgres with pgvector.
export default defineConfig({
  test: { include: ["test/db/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000 },
});
