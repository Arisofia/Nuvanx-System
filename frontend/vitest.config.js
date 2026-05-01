import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/**/*.test.{js,ts,mjs,cjs}',
      'src/**/*.test.{js,ts,jsx,tsx,mjs,cjs}',
    ],
    reporters: 'default',
  },
});
