import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "artifacts/**/src/**/*.test.ts",
      "artifacts/**/tests/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 20_000,
  },
});
