import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  here,
  '../../migrations/374_gp_assertion_receipts.sql',
);

describe('migration 374 Golden Path assertion receipts contract', () => {
  it('defines immutable real-execution assertion receipts', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/assertion_revision BIGINT NOT NULL DEFAULT 1/);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS journey_assertion_receipts/,
    );
    expect(sql).toMatch(/UNIQUE\s*\(run_id,\s*journey_step_link_id\)/);
    expect(sql).toMatch(/scenario_count\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/i);
    expect(sql).toMatch(/scenario_evidence\s+JSONB\s+NOT NULL\s+DEFAULT\s+'\{\}'::jsonb/i);
    expect(sql).toMatch(/verdict\s*=\s*'PASS'[\s\S]+scenario_count\s*>\s*0/i);
    expect(sql).toMatch(/scenario_evidence\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(
      /synthetic\s+BOOLEAN[^;]+CHECK\s*\(synthetic\s*=\s*false\)/s,
    );
    expect(sql).toMatch(/ON DELETE RESTRICT/);
    expect(sql).toMatch(/prevent_journey_assertion_receipt_mutation/);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
