import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);

describe('migration 375 Kernel run identity', () => {
  it('adds source identity, a task foreign key, an insert fence, and active-run uniqueness', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS created_source TEXT/);
    expect(sql).toMatch(/kernel_dispatch/);
    expect(sql).toMatch(/foreground_handoff/);
    expect(sql).toMatch(/legacy_relay/);
    expect(sql).toMatch(/explicit_recovery/);
    expect(sql).toMatch(/historical_reconstruction/);
    expect(sql).toMatch(/FOREIGN KEY\s*\(current_task_id\)[\s\S]+REFERENCES tasks\s*\(id\)[\s\S]+NOT VALID/i);
    expect(sql).toMatch(/BEFORE INSERT ON initiative_runs/);
    expect(sql).toMatch(/NEW\.current_task_id IS NULL OR NEW\.created_source IS NULL/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]+current_task_id[\s\S]+phase NOT IN \('done', 'failed'\)/i,
    );
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
