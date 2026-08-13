import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = new URL('../../migrations/423_tasks_trigger_source_text.sql', import.meta.url);
const rollback = new URL('../../migrations/rollback/423_tasks_trigger_source_text.down.sql', import.meta.url);

describe('migration 423: tasks.trigger_source no longer truncates routed provenance', () => {
  it('widens trigger_source to text without rewriting values', () => {
    const sql = readFileSync(migration, 'utf8');
    expect(sql).toMatch(/ALTER TABLE\s+tasks[\s\S]*ALTER COLUMN\s+trigger_source\s+TYPE\s+text/i);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*['"]423['"]/i);
    expect(sql).not.toMatch(/substring|left\s*\(|right\s*\(/i);
  });

  it('refuses a lossy rollback and removes the version marker only after narrowing', () => {
    const sql = readFileSync(rollback, 'utf8');
    expect(sql).toMatch(/length\s*\(trigger_source\)\s*>\s*20/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql.indexOf('ALTER TABLE')).toBeLessThan(sql.indexOf('DELETE FROM schema_version'));
  });
});
