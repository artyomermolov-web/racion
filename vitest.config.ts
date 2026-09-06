import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Ядро тестируется без БД и без UI, на in-memory-фикстурах (spec.md).
    include: ["src/core/**/*.test.ts"],
    environment: "node",
  },
});
