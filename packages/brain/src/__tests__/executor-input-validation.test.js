/**
 * Executor Input Validation Tests
 * Tests assertSafeId and assertSafePid defense-in-depth functions.
 */

import { describe, it, expect } from 'vitest';
import { assertSafeId, assertSafePid } from '../executor.js';

describe('assertSafeId', () => {
  it('accepts valid UUID', () => {
    expect(() => assertSafeId('550e8400-e29b-41d4-a716-446655440000', 'taskId')).not.toThrow();
  });

  it('accepts hex-only string', () => {
    expect(() => assertSafeId('abc123def456', 'runId')).not.toThrow();
  });

  it('accepts UUID without dashes', () => {
    expect(() => assertSafeId('550e8400e29b41d4a716446655440000', 'id')).not.toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertSafeId('abc; rm -rf /', 'taskId')).toThrow('[executor] Invalid taskId');
  });

  it('rejects backtick injection', () => {
    expect(() => assertSafeId('abc`whoami`', 'taskId')).toThrow('[executor] Invalid taskId');
  });

  it('rejects $() command substitution', () => {
    expect(() => assertSafeId('$(cat /etc/passwd)', 'runId')).toThrow('[executor] Invalid runId');
  });

  it('rejects pipe character', () => {
    expect(() => assertSafeId('abc|cat', 'id')).toThrow('[executor] Invalid id');
  });

  it('rejects non-string input', () => {
    expect(() => assertSafeId(12345, 'id')).toThrow('[executor] Invalid id');
    expect(() => assertSafeId(null, 'id')).toThrow('[executor] Invalid id');
    expect(() => assertSafeId(undefined, 'id')).toThrow('[executor] Invalid id');
  });

  it('rejects empty string', () => {
    expect(() => assertSafeId('', 'id')).toThrow('[executor] Invalid id');
  });

  it('accepts alphanumeric with dashes and underscores', () => {
    expect(() => assertSafeId('run-abc-123', 'id')).not.toThrow();
    expect(() => assertSafeId('task_ABC-456', 'id')).not.toThrow();
  });

  it('rejects whitespace', () => {
    expect(() => assertSafeId('abc 123', 'id')).toThrow('[executor] Invalid id');
  });
});

describe('assertSafePid', () => {
  it('accepts numeric PID', () => {
    expect(() => assertSafePid(12345, 'pid')).not.toThrow();
    expect(() => assertSafePid('12345', 'pid')).not.toThrow();
  });

  it('accepts PID 1', () => {
    expect(() => assertSafePid(1, 'pid')).not.toThrow();
  });

  it('rejects non-numeric PID', () => {
    expect(() => assertSafePid('abc', 'pid')).toThrow('[executor] Invalid pid');
  });

  it('rejects PID with shell injection', () => {
    expect(() => assertSafePid('123; rm -rf /', 'ppid')).toThrow('[executor] Invalid ppid');
  });

  it('rejects negative PID', () => {
    expect(() => assertSafePid('-1', 'pid')).toThrow('[executor] Invalid pid');
  });

  it('rejects NaN', () => {
    expect(() => assertSafePid(NaN, 'pid')).toThrow('[executor] Invalid pid');
  });
});
