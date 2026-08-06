import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Test files share one SQLite test database and reset its tables in
    // beforeEach. Running files concurrently causes lock errors and cross-file
    // data deletion, so database tests must be serialized.
    fileParallelism: false,
    exclude: ["web/**", "node_modules/**", "dist/**"],
    env: {
      DATABASE_PATH: "./data/test.db",
      DEFAULT_SEASON_ID: "test-season"
    }
  }
});
