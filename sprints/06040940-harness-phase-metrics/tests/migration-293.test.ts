import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATION_PATH = path.join(REPO_ROOT, 'packages/brain/migrations/293_initiative_run_events_phase_metrics.sql');

describe('migration 293 — 三列 + status CHECK + selfcheck [ARTIFACT]', () => {
  it("文件含 3 ADD COLUMN + status CHECK 'completed'；selfcheck = '293'", async () => {
    const sql = await fs.promises.readFile(MIGRATION_PATH, 'utf8');
    expect(sql).toMatch(/ADD COLUMN[^\n]*ts_end[^\n]*BIGINT/i);
    expect(sql).toMatch(/ADD COLUMN[^\n]*cost_usd[^\n]*NUMERIC/i);
    expect(sql).toMatch(/ADD COLUMN[^\n]*model[^\n]*TEXT/i);
    expect(sql).toMatch(/completed/i);
    const selfcheck = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/selfcheck.js'), 'utf8');
    expect(selfcheck).toMatch(/EXPECTED_SCHEMA_VERSION\s*=\s*'293'/);
  });
});
