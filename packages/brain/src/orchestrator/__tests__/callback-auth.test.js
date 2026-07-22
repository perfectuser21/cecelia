import { describe, expect, it } from 'vitest';

import {
  generateCallbackSecret,
  hashCallbackSecret,
  verifyCallbackSecret,
} from '../callback-auth.js';

describe('callback-auth', () => {
  it('generates independent 256-bit URL-safe secrets', () => {
    const first = generateCallbackSecret();
    const second = generateCallbackSecret();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('accepts only the secret matching the stored hash', () => {
    const hash = hashCallbackSecret('attempt-secret');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCallbackSecret('attempt-secret', hash)).toBe(true);
    expect(verifyCallbackSecret('wrong-secret', hash)).toBe(false);
    expect(verifyCallbackSecret('', hash)).toBe(false);
    expect(verifyCallbackSecret('attempt-secret', 'not-a-hash')).toBe(false);
  });
});
