import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../migrations/379_v2_active_run_parent_task_guard.sql',
  import.meta.url,
);

describe('migration 379 active v2 run parent task guard', () => {
  it('extends the insert trigger to lock and reject terminal parent tasks', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION lock_initiative_run_insert_identity/i);
    expect(sql).toMatch(/relay-prefix:[\s\S]+relay-initiative:/i);
    expect(sql).toMatch(
      /NEW\.orchestrator_version = 'v2'[\s\S]+NEW\.phase NOT IN \('done', 'failed'\)/i,
    );
    expect(sql).toMatch(
      /SELECT status[\s\S]+FROM tasks[\s\S]+WHERE id = NEW\.current_task_id[\s\S]+FOR UPDATE/i,
    );
    expect(sql).toMatch(/'completed'[\s\S]+'failed'[\s\S]+'cancelled'[\s\S]+'canceled'/i);
    expect(sql).toMatch(/ERRCODE = '23514'/i);
    expect(sql).toMatch(
      /INSERT INTO schema_version[\s\S]+VALUES \('379'/i,
    );
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
