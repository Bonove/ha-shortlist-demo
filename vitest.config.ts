import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    // Never run against the demo's own state: a test run must not be able to
    // leave the presentation on a different snapshot.
    env: { HA_DATA_DIR: 'data-test' },
    globalSetup: ['./vitest.global-setup.ts'],
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
