// 真 PostgreSQL integration 入册：复用批准合同测试，不引入 pool/db mock。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';

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

test('integration fixture 使用隔离的真实 PostgreSQL', async () => {
  const client = new pg.Client({
    connectionString: process.env.HARNESS_TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    const result = await client.query('SELECT current_database() AS name');
    expect(result.rows[0].name).toMatch(/(?:_test|^preview_)/);
  } finally {
    await client.end();
  }
});

await import(
  '../../../../../sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts'
);
