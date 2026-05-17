import { describe, it, expect } from 'vitest';
import { classifyFailure, shouldRetry } from '../retry-circuit.js';

describe('classifyFailure()', () => {
  it('exit_code 0 → success', () => {
    expect(classifyFailure({ exit_code: 0, stdout: '', stderr: '' }).class).toBe('success');
  });
  it('timed_out true → transient', () => {
    expect(classifyFailure({ exit_code: 137, timed_out: true, stderr: '' }).class).toBe('transient');
  });
  it('exit_code 124 → transient timeout', () => {
    expect(classifyFailure({ exit_code: 124, stderr: '' }).class).toBe('transient');
  });
  it('exit_code 137 without timed_out → permanent OOM', () => {
    expect(classifyFailure({ exit_code: 137, stderr: '' }).class).toBe('permanent');
  });
  it('Unable to find image → permanent', () => {
    expect(classifyFailure({ exit_code: 125, stderr: 'Unable to find image myimg' }).class).toBe('permanent');
  });
  it('ECONNREFUSED → transient', () => {
    expect(classifyFailure({ exit_code: 1, stderr: 'connect ECONNREFUSED 127.0.0.1:8080' }).class).toBe('transient');
  });
  it('unknown exit_code → transient default', () => {
    expect(classifyFailure({ exit_code: 42, stderr: 'weird error' }).class).toBe('transient');
  });
  it('null result → transient', () => {
    expect(classifyFailure(null).class).toBe('transient');
  });
});

describe('shouldRetry()', () => {
  it('permanent never retries', () => {
    expect(shouldRetry({ class: 'permanent' }, 0, 3)).toBe(false);
  });
  it('success never retries', () => {
    expect(shouldRetry({ class: 'success' }, 0, 3)).toBe(false);
  });
  it('transient retries when attempts < max', () => {
    expect(shouldRetry({ class: 'transient' }, 0, 3)).toBe(true);
    expect(shouldRetry({ class: 'transient' }, 1, 3)).toBe(true);
  });
  it('transient stops at max attempts', () => {
    expect(shouldRetry({ class: 'transient' }, 2, 3)).toBe(false);
  });
  it('null classification → no retry', () => {
    expect(shouldRetry(null, 0, 3)).toBe(false);
  });
});
