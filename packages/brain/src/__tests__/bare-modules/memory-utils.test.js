/**
 * Bare Module Test: memory-utils.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';
import { generateL0Summary, generateMemoryStreamL1Async } from '../../memory-utils.js';

describe('memory-utils module', () => {
  it('exports generateL0Summary function', () => {
    expect(typeof generateL0Summary).toBe('function');
  });

  it('exports generateMemoryStreamL1Async function', () => {
    expect(typeof generateMemoryStreamL1Async).toBe('function');
  });

  it('generateL0Summary returns a string for valid input', () => {
    const result = generateL0Summary('Hello world this is a test string');
    expect(typeof result).toBe('string');
  });
});
