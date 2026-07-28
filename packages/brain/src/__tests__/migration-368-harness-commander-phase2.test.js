import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../../migrations/368_harness_commander_phase2.sql', import.meta.url);
const migrationPath = fileURLToPath(migrationUrl);
const sql = existsSync(migrationPath) ? readFileSync(migrationUrl, 'utf8') : '';

describe('migration 368 Harness Commander Phase 2', () => {
  it('adds commander to the existing Harness Attempt role constraint', () => {
    expect(sql, 'migration 368 must exist').not.toBe('');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS harness_attempts_role_check');
    expect(sql).toContain('ADD CONSTRAINT harness_attempts_role_check');
    for (const role of [
      'planner',
      'proposer',
      'reviewer',
      'generator',
      'evaluator',
      'judge',
      'reporter',
      'commander',
    ]) {
      expect(sql).toMatch(new RegExp(`'${role}'`));
    }
    expect(sql).toMatch(/VALUES\s*\(\s*'368'/);
  });

  it('does not recreate or remove the authoritative attempts table', () => {
    expect(sql).not.toMatch(/(?:CREATE|DROP)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+harness_attempts/i);
  });
});
