import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../migrations/406_harness_attempt_account_exhausted.sql', import.meta.url),
  'utf8',
);

describe('migration 406 account_exhausted callback class', () => {
  it('extends the strict attempt failure-class invariant without removing existing classes', () => {
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS harness_attempts_failure_class_check/i,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT harness_attempts_failure_class_check[\s\S]*'account_exhausted'/i,
    );
    for (const failureClass of [
      'infrastructure_blocked',
      'runner_failure',
      'semantic_refusal',
      'needs_context',
    ]) {
      expect(migration).toContain(`'${failureClass}'`);
    }
    expect(migration).toMatch(/VALUES \('406'/i);
  });
});
