import { defineConfig } from 'vitest/config';

// E2E（Playwright）は tests/e2e/ で扱うため、Vitest の対象から外す。
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'node',
  },
});
