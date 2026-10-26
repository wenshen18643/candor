import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
});
