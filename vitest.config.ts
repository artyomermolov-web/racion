import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Алиас @/* → ./src/* как в tsconfig, чтобы ядро тестировалось теми же путями,
  // что и приложение (напр. @/core/nutrition в /core/generator).
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Ядро тестируется без БД и без UI, на in-memory-фикстурах (spec.md).
    // Плюс чистые мапперы семьи src/lib/food-labels (тикет 12) — тоже без БД/UI.
    include: ["src/core/**/*.test.ts", "src/lib/**/*.test.ts"],
    environment: "node",
  },
});
