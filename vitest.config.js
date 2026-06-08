import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    testTimeout: 20000,
    // Integración y E2E comparten una base y la reinician (DROP SCHEMA):
    // ejecutar archivos en serie evita que se pisen.
    fileParallelism: false,
  },
});
