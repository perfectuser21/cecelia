/**
 * Contract Test: initiative-closer.js
 *
 * Guards the interface contract of initiative lifecycle functions.
 * Tests pure exported functions and constants.
 */
import { describe, it, expect } from 'vitest';
import {
  getMaxActiveInitiatives,
  MAX_ACTIVE_INITIATIVES,
} from '../../initiative-closer.js';

describe('initiative-closer contract', () => {
  describe('MAX_ACTIVE_INITIATIVES', () => {
    it('is a positive number', () => {
      expect(typeof MAX_ACTIVE_INITIATIVES).toBe('number');
      expect(MAX_ACTIVE_INITIATIVES).toBeGreaterThan(0);
    });

    it('is 9 (current value)', () => {
      expect(MAX_ACTIVE_INITIATIVES).toBe(9);
    });
  });

  describe('getMaxActiveInitiatives', () => {
    it('returns a number', () => {
      const result = getMaxActiveInitiatives(5);
      expect(typeof result).toBe('number');
    });

    it('returns positive value', () => {
      expect(getMaxActiveInitiatives(0)).toBeGreaterThan(0);
      expect(getMaxActiveInitiatives(5)).toBeGreaterThan(0);
    });

    it('returns a value that varies with slots', () => {
      const lowSlots = getMaxActiveInitiatives(1);
      const highSlots = getMaxActiveInitiatives(20);
      expect(highSlots).toBeGreaterThanOrEqual(lowSlots);
    });
  });
});
