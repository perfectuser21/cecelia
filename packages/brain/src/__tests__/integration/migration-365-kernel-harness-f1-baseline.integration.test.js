// 真 PostgreSQL integration 入册：复用批准合同测试，不引入 pool/db mock。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll } from 'vitest';

if (!process.env.HARNESS_TEST_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.HARNESS_TEST_DATABASE_URL = process.env.DATABASE_URL;
}
const originalCwd = process.cwd();
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);
beforeAll(() => process.chdir(repositoryRoot));
afterAll(() => process.chdir(originalCwd));
await import(
  '../../../../../sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts'
);
