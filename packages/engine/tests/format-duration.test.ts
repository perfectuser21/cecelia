import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../lib/format-duration.sh');

function fmt(ms: number | string): string {
  return execSync(
    `bash -c 'source ${SCRIPT} && format_duration_ms ${ms}'`,
    { encoding: 'utf-8' }
  ).trim();
}

describe('format_duration_ms', () => {
  it('90061000ms → 1d 1h 1m 1s', () => {
    expect(fmt(90061000)).toBe('1d 1h 1m 1s');
  });

  it('3600000ms → 1h 0m 0s', () => {
    expect(fmt(3600000)).toBe('1h 0m 0s');
  });

  it('65000ms → 1m 5s', () => {
    expect(fmt(65000)).toBe('1m 5s');
  });

  it('5000ms → 5s', () => {
    expect(fmt(5000)).toBe('5s');
  });

  it('500ms → 0.5s', () => {
    expect(fmt(500)).toBe('0.5s');
  });

  it('0ms → 0s', () => {
    expect(fmt(0)).toBe('0s');
  });

  it('invalid input → 0s', () => {
    expect(fmt('abc')).toBe('0s');
  });
});
