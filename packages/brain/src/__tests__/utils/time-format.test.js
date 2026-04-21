import { describe, it, expect } from 'vitest';
import {
  isValidTimeZone,
  formatIsoAtTz,
} from '../../utils/time-format.js';

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

describe('Workstream 1 — Time formatting utilities [BEHAVIOR]', () => {
  describe('isValidTimeZone', () => {
    it('isValidTimeZone returns true for UTC', () => {
      expect(isValidTimeZone('UTC')).toBe(true);
    });

    it('isValidTimeZone returns true for Asia/Shanghai', () => {
      expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    });

    it('isValidTimeZone returns false for invalid IANA name Foo/Bar', () => {
      expect(isValidTimeZone('Foo/Bar')).toBe(false);
    });

    it('isValidTimeZone returns false for empty string', () => {
      expect(isValidTimeZone('')).toBe(false);
    });

    it('isValidTimeZone returns false for undefined', () => {
      expect(isValidTimeZone(undefined)).toBe(false);
    });
  });

  describe('formatIsoAtTz', () => {
    it('formatIsoAtTz outputs ISO-8601 with offset suffix', () => {
      const out = formatIsoAtTz(new Date('2026-01-01T00:00:00Z'), 'Asia/Shanghai');
      expect(typeof out).toBe('string');
      expect(out).toMatch(ISO_WITH_OFFSET);
    });

    it('formatIsoAtTz roundtrips to the same instant', () => {
      const input = new Date('2026-07-15T12:34:56Z');
      const out = formatIsoAtTz(input, 'Asia/Shanghai');
      const parsed = new Date(out);
      expect(parsed.getTime()).toBe(input.getTime());
    });

    it('formatIsoAtTz applies +08:00 offset for Asia/Shanghai', () => {
      const out = formatIsoAtTz(new Date('2026-01-01T00:00:00Z'), 'Asia/Shanghai');
      expect(out.endsWith('+08:00')).toBe(true);
    });

    it('formatIsoAtTz applies zero offset for UTC', () => {
      const out = formatIsoAtTz(new Date('2026-01-01T00:00:00Z'), 'UTC');
      expect(/(\+00:00|Z)$/.test(out)).toBe(true);
    });
  });
});
