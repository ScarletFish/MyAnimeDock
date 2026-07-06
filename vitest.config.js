import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['public/__tests__/**/*.test.js'],
    globals: true,
    testTimeout: 10000
  },
  resolve: {
    alias: {
      // Map node modules for jsdom environment
      'node:fs': 'fs',
      'node:path': 'path'
    }
  }
});
