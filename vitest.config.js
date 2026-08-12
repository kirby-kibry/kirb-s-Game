import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['_extras/tests/**/*.test.js'],
    globals: true,
    // Every suite resets the same local.db file before it runs, so they have to
    // take turns. Running them at the same time makes them delete each other's
    // database halfway through.
    fileParallelism: false,
  },
});
