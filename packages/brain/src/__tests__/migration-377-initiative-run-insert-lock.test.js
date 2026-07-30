import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../migrations/377_initiative_run_insert_identity_lock.sql',
  import.meta.url,
);

describe('migration 377 initiative run insert identity lock', () => {
  it('forces every INSERT to take prefix and full initiative transaction locks', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION lock_initiative_run_insert_identity/i);
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]+relay-prefix:/i);
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]+relay-initiative:/i);
    expect(sql).toMatch(/BEFORE INSERT ON initiative_runs/i);
    expect(sql).toMatch(/FOR EACH ROW/i);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
