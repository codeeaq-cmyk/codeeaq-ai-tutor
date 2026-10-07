import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@codeeaq/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
