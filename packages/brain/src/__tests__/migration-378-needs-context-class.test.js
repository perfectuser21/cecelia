import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../migrations/378_harness_attempt_needs_context_class.sql', import.meta.url),
  'utf8',
);

describe('migration 378 needs_context callback class', () => {
  it('extends the existing attempt failure-class invariant without dropping it', () => {
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS harness_attempts_failure_class_check/i,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT harness_attempts_failure_class_check[\s\S]*'needs_context'/i,
    );
    expect(migration).toMatch(/VALUES \('378'/i);
  });
});
