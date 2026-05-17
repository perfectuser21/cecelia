import { describe, it, expect } from 'vitest';
import { add, multiply } from '../../src/utils/mathUtils';

describe('mathUtils', () => {
  describe('add', () => {
    it('should add two positive numbers', () => {
      const result = add(2, 3);
      expect(result).toBe(5);
    });

    it('should add negative numbers', () => {
      const result = add(-2, -3);
      expect(result).toBe(-5);
    });

    it('should add zero', () => {
      const result = add(5, 0);
      expect(result).toBe(5);
    });
  });

  describe('multiply', () => {
    it('should multiply two positive numbers', () => {
      const result = multiply(2, 3);
      expect(result).toBe(6);
    });

    it('should multiply negative numbers', () => {
      const result = multiply(-2, 3);
      expect(result).toBe(-6);
    });

    it('should multiply by zero', () => {
      const result = multiply(5, 0);
      expect(result).toBe(0);
    });
  });
});
