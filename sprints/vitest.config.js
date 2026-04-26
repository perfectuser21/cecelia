import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export default defineConfig({
  root: REPO_ROOT,
  test: {
    include: ['sprints/tests/**/*.test.{js,mjs,ts}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
