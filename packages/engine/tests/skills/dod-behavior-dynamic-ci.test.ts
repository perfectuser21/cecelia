import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '../../../..');
const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const dynamicJob = workflow.match(
  /^\s{2}dod-behavior-dynamic:[\s\S]*?(?=^\s{2}[a-zA-Z0-9_-]+:)/m,
)?.[0] ?? '';

describe('dod-behavior-dynamic PostgreSQL evidence gate', () => {
  it('passes the isolated PostgreSQL URL through the explicit test-only variable', () => {
    expect(dynamicJob).toContain(
      'TEST_DATABASE_URL: postgresql://cecelia:${{ secrets.CI_DB_PASSWORD }}@localhost:5432/cecelia_test',
    );
  });

  it('rejects a successful vitest process that executed zero tests', () => {
    expect(dynamicJob).toContain('Vitest command executed zero tests');
    expect(dynamicJob).toMatch(/VITEST_EXECUTED_COUNT/);
    expect(dynamicJob).toMatch(/VITEST_EXECUTED_COUNT["'}\]]*\s*-eq\s+0/);
  });
});
