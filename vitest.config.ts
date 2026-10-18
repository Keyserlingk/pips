import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The generator works against a wall-clock budget. Test files running in
    // parallel compete for the CPU, so generation gets less done in the same
    // time and timing-sensitive tests fail; run files one at a time instead.
    fileParallelism: false,
  },
});
