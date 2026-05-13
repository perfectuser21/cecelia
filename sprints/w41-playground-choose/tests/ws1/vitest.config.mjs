import { defineConfig } from '/workspace/playground/node_modules/vitest/dist/config.js';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'supertest': resolve('/workspace/playground/node_modules/supertest'),
    },
  },
  test: {
    include: ['*.test.ts'],
  },
});
