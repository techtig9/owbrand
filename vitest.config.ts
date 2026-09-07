import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The `@/*` alias is declared here directly rather than via
 * vite-tsconfig-paths: that plugin is ESM-only from v5, and this config is
 * loaded through require, so it fails to bundle. One alias is not worth a
 * dependency — keep it in sync with the `paths` entry in tsconfig.json.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
