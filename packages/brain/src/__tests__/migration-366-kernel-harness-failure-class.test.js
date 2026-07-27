import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../migrations/366_kernel_harness_failure_class.sql', import.meta.url),
  'utf8',
);

describe('migration 366 Kernel Harness failure class', () => {
  it('adds a nullable bounded canonical failure class without rewriting attempts', () => {
    expect(sql).toMatch(
      /ALTER TABLE harness_attempts[\s\S]*ADD COLUMN IF NOT EXISTS failure_class TEXT/,
    );
    expect(sql).toMatch(/harness_attempts_failure_class_check/);
    for (const failureClass of [
      'infrastructure_blocked',
      'runner_failure',
      'semantic_refusal',
    ]) {
      expect(sql).toContain(`'${failureClass}'`);
    }
    expect(sql).toMatch(/VALUES\s*\(\s*'366'/);
  });
});
