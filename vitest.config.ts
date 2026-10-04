/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'coverage/',
        '**/*.test.{ts,tsx,js,jsx}',
        '**/*.spec.{ts,tsx,js,jsx}',
      ],
      // Vitest 0.34 reads thresholds from these TOP-LEVEL keys. The nested
      // `coverage.thresholds.global` shape belongs to Vitest 1.x+; under 0.34
      // it is silently ignored, which is why `pnpm test:coverage` exited 0 even
      // with the limit set to 99. Verified by setting an impossible value and
      // confirming the run now fails.
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
