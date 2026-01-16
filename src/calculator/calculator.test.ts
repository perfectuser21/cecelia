/**
 * Calculator Tests
 * Comprehensive test coverage for all operations
 */

import { describe, it, expect } from 'vitest';
import { calculate, chain } from './calculator';
import { Operation } from './types';

describe('calculate', () => {
  describe('Addition (ADD)', () => {
    it('adds two positive numbers', () => {
      const result = calculate({ a: 2, b: 3, operation: Operation.ADD });
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });

    it('adds negative numbers', () => {
      const result = calculate({ a: -5, b: -3, operation: Operation.ADD });
      expect(result.success).toBe(true);
      expect(result.value).toBe(-8);
    });

    it('adds decimals', () => {
      const result = calculate({ a: 0.1, b: 0.2, operation: Operation.ADD });
      expect(result.success).toBe(true);
      expect(result.value).toBeCloseTo(0.3);
    });

    it('adds zero', () => {
      const result = calculate({ a: 5, b: 0, operation: Operation.ADD });
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });
  });

  describe('Subtraction (SUB)', () => {
    it('subtracts two positive numbers', () => {
      const result = calculate({ a: 10, b: 4, operation: Operation.SUB });
      expect(result.success).toBe(true);
      expect(result.value).toBe(6);
    });

    it('subtracts to negative result', () => {
      const result = calculate({ a: 3, b: 10, operation: Operation.SUB });
      expect(result.success).toBe(true);
      expect(result.value).toBe(-7);
    });

    it('subtracts negative numbers', () => {
      const result = calculate({ a: -5, b: -3, operation: Operation.SUB });
      expect(result.success).toBe(true);
      expect(result.value).toBe(-2);
    });
  });

  describe('Multiplication (MUL)', () => {
    it('multiplies two positive numbers', () => {
      const result = calculate({ a: 4, b: 5, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(20);
    });

    it('multiplies by zero', () => {
      const result = calculate({ a: 100, b: 0, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('multiplies negative numbers', () => {
      const result = calculate({ a: -3, b: -4, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(12);
    });

    it('multiplies mixed signs', () => {
      const result = calculate({ a: -3, b: 4, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(-12);
    });

    it('multiplies decimals', () => {
      const result = calculate({ a: 2.5, b: 4, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(10);
    });
  });

  describe('Division (DIV)', () => {
    it('divides two positive numbers', () => {
      const result = calculate({ a: 20, b: 4, operation: Operation.DIV });
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });

    it('divides with decimal result', () => {
      const result = calculate({ a: 7, b: 2, operation: Operation.DIV });
      expect(result.success).toBe(true);
      expect(result.value).toBe(3.5);
    });

    it('handles division by zero', () => {
      const result = calculate({ a: 10, b: 0, operation: Operation.DIV });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Division by zero');
      expect(result.value).toBeNaN();
    });

    it('divides zero by non-zero', () => {
      const result = calculate({ a: 0, b: 5, operation: Operation.DIV });
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('divides negative numbers', () => {
      const result = calculate({ a: -12, b: -4, operation: Operation.DIV });
      expect(result.success).toBe(true);
      expect(result.value).toBe(3);
    });
  });

  describe('Power (POW)', () => {
    it('calculates positive power', () => {
      const result = calculate({ a: 2, b: 3, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(8);
    });

    it('calculates power of zero', () => {
      const result = calculate({ a: 5, b: 0, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('calculates zero to positive power', () => {
      const result = calculate({ a: 0, b: 5, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('calculates negative exponent', () => {
      const result = calculate({ a: 2, b: -2, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(0.25);
    });

    it('calculates fractional exponent', () => {
      const result = calculate({ a: 4, b: 0.5, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(2);
    });

    it('handles negative base with odd exponent', () => {
      const result = calculate({ a: -2, b: 3, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(-8);
    });

    it('handles negative base with even exponent', () => {
      const result = calculate({ a: -2, b: 2, operation: Operation.POW });
      expect(result.success).toBe(true);
      expect(result.value).toBe(4);
    });

    it('handles negative base with fractional exponent (returns NaN)', () => {
      // Math.pow(-4, 0.5) = NaN (square root of negative)
      const result = calculate({ a: -4, b: 0.5, operation: Operation.POW });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Result is not finite');
      expect(result.value).toBeNaN();
    });
  });

  describe('Edge Cases', () => {
    it('handles very large numbers', () => {
      const result = calculate({ a: 1e100, b: 2, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(2e100);
    });

    it('handles very small numbers', () => {
      const result = calculate({ a: 1e-100, b: 2, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBe(2e-100);
    });

    it('handles overflow to Infinity', () => {
      const result = calculate({ a: 1e308, b: 1e308, operation: Operation.MUL });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Result is not finite');
    });

    it('returns input in result', () => {
      const input = { a: 5, b: 3, operation: Operation.ADD };
      const result = calculate(input);
      expect(result.input).toEqual(input);
    });
  });

  describe('Floating Point Precision', () => {
    it('handles decimal subtraction with toBeCloseTo', () => {
      const result = calculate({ a: 0.3, b: 0.1, operation: Operation.SUB });
      expect(result.success).toBe(true);
      expect(result.value).toBeCloseTo(0.2);
    });

    it('handles decimal multiplication with toBeCloseTo', () => {
      const result = calculate({ a: 0.1, b: 0.2, operation: Operation.MUL });
      expect(result.success).toBe(true);
      expect(result.value).toBeCloseTo(0.02);
    });

    it('handles decimal division with toBeCloseTo', () => {
      const result = calculate({ a: 1, b: 3, operation: Operation.DIV });
      expect(result.success).toBe(true);
      expect(result.value).toBeCloseTo(0.333333, 5);
    });
  });

  describe('Input Validation', () => {
    it('rejects NaN as input a', () => {
      const result = calculate({ a: NaN, b: 5, operation: Operation.ADD });
      expect(result.success).toBe(false);
      expect(result.error).toContain("'a' is not a finite number");
    });

    it('rejects NaN as input b', () => {
      const result = calculate({ a: 5, b: NaN, operation: Operation.ADD });
      expect(result.success).toBe(false);
      expect(result.error).toContain("'b' is not a finite number");
    });

    it('rejects Infinity as input', () => {
      const result = calculate({ a: Infinity, b: 5, operation: Operation.ADD });
      expect(result.success).toBe(false);
      expect(result.error).toContain("'a' is not a finite number");
    });

    it('rejects negative Infinity as input', () => {
      const result = calculate({ a: 5, b: -Infinity, operation: Operation.DIV });
      expect(result.success).toBe(false);
      expect(result.error).toContain("'b' is not a finite number");
    });
  });
});

describe('chain', () => {
  describe('Basic Chaining', () => {
    it('chains multiple operations', () => {
      const result = chain(10)
        .add(5)
        .mul(2)
        .sub(10)
        .div(2)
        .result();

      expect(result.success).toBe(true);
      expect(result.value).toBe(10); // ((10 + 5) * 2 - 10) / 2 = 10
    });

    it('starts from zero', () => {
      const result = chain(0).add(5).result();
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });

    it('starts from negative', () => {
      const result = chain(-10).add(15).result();
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });
  });

  describe('Chain Operations', () => {
    it('chains add operations', () => {
      const result = chain(1).add(2).add(3).add(4).result();
      expect(result.value).toBe(10);
    });

    it('chains sub operations', () => {
      const result = chain(20).sub(5).sub(3).sub(2).result();
      expect(result.value).toBe(10);
    });

    it('chains mul operations', () => {
      const result = chain(2).mul(3).mul(4).result();
      expect(result.value).toBe(24);
    });

    it('chains div operations', () => {
      const result = chain(100).div(2).div(5).result();
      expect(result.value).toBe(10);
    });

    it('chains pow operations', () => {
      const result = chain(2).pow(3).pow(2).result();
      expect(result.value).toBe(64); // (2^3)^2 = 8^2 = 64
    });
  });

  describe('Chain Value Access', () => {
    it('allows access to intermediate value', () => {
      const calc = chain(10).add(5);
      expect(calc.value).toBe(15);

      const final = calc.mul(2).result();
      expect(final.value).toBe(30);
    });
  });

  describe('Chain Error Handling', () => {
    it('propagates division by zero error', () => {
      const result = chain(10).div(0).add(5).result();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Division by zero');
    });

    it('continues chain after error with NaN', () => {
      const result = chain(10).div(0).mul(2).result();
      expect(result.success).toBe(false);
      expect(result.value).toBeNaN();
    });

    it('rejects non-finite initial value (Infinity)', () => {
      const result = chain(Infinity).add(5).result();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Initial value is not finite');
    });

    it('rejects non-finite initial value (NaN)', () => {
      const result = chain(NaN).add(5).result();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Initial value is not finite');
    });

    it('rejects non-finite initial value (-Infinity)', () => {
      const result = chain(-Infinity).mul(2).result();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Initial value is not finite');
    });
  });

  describe('Chain Result Input', () => {
    it('returns last operation input in result', () => {
      const result = chain(10).add(5).mul(2).result();
      expect(result.input.operation).toBe(Operation.MUL);
      expect(result.input.a).toBe(15); // 10 + 5
      expect(result.input.b).toBe(2);
    });

    it('returns placeholder input when no operations', () => {
      const result = chain(10).result();
      expect(result.input.a).toBe(10);
      expect(result.input.operation).toBe(Operation.ADD);
    });
  });

  describe('Complex Chains', () => {
    it('calculates compound interest formula', () => {
      // Principal * (1 + rate)^time
      // 1000 * (1 + 0.05)^3 = 1000 * 1.157625 = 1157.625
      const principal = 1000;
      const rate = 0.05;
      const time = 3;

      const result = chain(1)
        .add(rate)
        .pow(time)
        .mul(principal)
        .result();

      expect(result.success).toBe(true);
      expect(result.value).toBeCloseTo(1157.625, 2);
    });

    it('handles mixed positive and negative operations', () => {
      const result = chain(100)
        .sub(50)
        .mul(-2)
        .add(200)
        .div(-4)
        .result();

      // ((100 - 50) * -2 + 200) / -4 = (50 * -2 + 200) / -4 = (-100 + 200) / -4 = 100 / -4 = -25
      expect(result.success).toBe(true);
      expect(result.value).toBe(-25);
    });
  });

  describe('Extreme Values', () => {
    it('handles chain with very large numbers causing overflow', () => {
      const result = chain(1e200).mul(1e200).result();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Result is not finite');
    });

    it('handles chain with very small numbers', () => {
      const result = chain(1e-200).div(1e200).result();
      expect(result.success).toBe(true);
      expect(result.value).toBe(0); // Underflow to 0
    });

    it('handles multiple consecutive errors (only first recorded)', () => {
      const result = chain(1)
        .div(0)  // Error 1: Division by zero
        .div(0)  // Error 2: Would also fail but value is already NaN
        .result();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Division by zero'); // First error only
    });
  });
});
