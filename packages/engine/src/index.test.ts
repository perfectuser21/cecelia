/**
 * Index module tests
 */

import { describe, it, expect } from 'vitest';
import { hello, validateHooks } from './index';

describe('hello', () => {
  it('returns greeting with name', () => {
    expect(hello('World')).toBe('Hello, World!');
  });

  it('handles empty string', () => {
    expect(hello('')).toBe('Hello, !');
  });
});

describe('validateHooks', () => {
  it('returns configured status', () => {
    const result = validateHooks();
    expect(result).toHaveProperty('configured');
    expect(typeof result.configured).toBe('boolean');
  });

  it('returns true when hooks are configured', () => {
    expect(validateHooks().configured).toBe(true);
  });
});
