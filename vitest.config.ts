import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The `@/*` alias is declared here directly rather than via
 * vite-tsconfig-paths: that plugin is ESM-only from v5, and this config is
 * loaded through require, so it fails to bundle. One alias is not worth a
 * dependency — keep it in sync with the `paths` entry in tsconfig.json.
 */
export default defineConfig({
  // tsconfig.json sets `jsx: "preserve"` because Next owns the JSX transform
  // in the app build. Vitest has no such downstream step, so esbuild is told
  // to compile JSX itself — without this, every .tsx test fails to parse.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // .tsx so React component tests live alongside the rest. Component
    // files opt into jsdom with a `@vitest-environment jsdom` docblock; the
    // default stays `node` so the ~200 logic tests keep their fast environment.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
