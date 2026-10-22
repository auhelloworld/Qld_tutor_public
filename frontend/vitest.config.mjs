import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      thresholds: {
        'src/lib/': { lines: 80, branches: 70 },
      },
    },
    globals: true,
  },
});
