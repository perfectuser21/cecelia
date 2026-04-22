import { describe, it, expect } from 'vitest';
import {
  validateIsoBody,
  validateTimezoneBody,
  validateUnixBody,
} from '../../../packages/brain/test/time-endpoints.smoke.mjs';

describe('Workstream 2 — validateIsoBody [BEHAVIOR]', () => {
  it('accepts ISO 8601 with millisecond precision and Z suffix', () => {
    expect(validateIsoBody({ iso: '2026-04-22T12:34:56.789Z' })).toBe(true);
  });

  it('accepts ISO 8601 with millisecond precision and ±HH:MM offset suffix', () => {
    expect(validateIsoBody({ iso: '2026-04-22T20:34:56.789+08:00' })).toBe(true);
    expect(validateIsoBody({ iso: '2026-04-22T07:34:56.789-05:00' })).toBe(true);
  });

  it('rejects body missing iso field', () => {
    expect(validateIsoBody({})).toBe(false);
    expect(validateIsoBody({ time: '2026-04-22T12:34:56.789Z' })).toBe(false);
  });

  it('rejects iso string without millisecond fraction', () => {
    expect(validateIsoBody({ iso: '2026-04-22T12:34:56Z' })).toBe(false);
  });

  it('rejects iso string without timezone suffix', () => {
    expect(validateIsoBody({ iso: '2026-04-22T12:34:56.789' })).toBe(false);
  });

  it('rejects non-object body (null / string / number)', () => {
    expect(validateIsoBody(null as any)).toBe(false);
    expect(validateIsoBody('2026-04-22T12:34:56.789Z' as any)).toBe(false);
    expect(validateIsoBody(123 as any)).toBe(false);
  });
});

describe('Workstream 2 — validateTimezoneBody [BEHAVIOR]', () => {
  it('accepts {timezone, offset, iso} with all three fields valid', () => {
    expect(validateTimezoneBody({
      timezone: 'Asia/Shanghai',
      offset: '+08:00',
      iso: '2026-04-22T20:34:56.789+08:00',
    })).toBe(true);
    expect(validateTimezoneBody({
      timezone: 'UTC',
      offset: '+00:00',
      iso: '2026-04-22T12:34:56.789Z',
    })).toBe(true);
  });

  it('rejects body missing timezone field', () => {
    expect(validateTimezoneBody({
      offset: '+08:00',
      iso: '2026-04-22T20:34:56.789+08:00',
    } as any)).toBe(false);
  });

  it('rejects body missing offset field', () => {
    expect(validateTimezoneBody({
      timezone: 'Asia/Shanghai',
      iso: '2026-04-22T20:34:56.789+08:00',
    } as any)).toBe(false);
  });

  it('rejects offset in HHMM (no-colon) format', () => {
    expect(validateTimezoneBody({
      timezone: 'Asia/Shanghai',
      offset: '+0800',
      iso: '2026-04-22T20:34:56.789+08:00',
    })).toBe(false);
  });

  it('rejects offset with single-digit hour (+8:00)', () => {
    expect(validateTimezoneBody({
      timezone: 'Asia/Shanghai',
      offset: '+8:00',
      iso: '2026-04-22T20:34:56.789+08:00',
    })).toBe(false);
  });
});

describe('Workstream 2 — validateUnixBody [BEHAVIOR]', () => {
  it('accepts a 10-digit positive integer (seconds)', () => {
    expect(validateUnixBody({ unix: 1745324400 })).toBe(true);
  });

  it('rejects 13-digit millisecond value', () => {
    expect(validateUnixBody({ unix: 1745324400000 })).toBe(false);
  });

  it('rejects zero and negative integers', () => {
    expect(validateUnixBody({ unix: 0 })).toBe(false);
    expect(validateUnixBody({ unix: -1745324400 })).toBe(false);
  });

  it('rejects string representation of integer', () => {
    expect(validateUnixBody({ unix: '1745324400' as any })).toBe(false);
  });

  it('rejects non-integer (float) value', () => {
    expect(validateUnixBody({ unix: 1745324400.5 })).toBe(false);
  });
});
