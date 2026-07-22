import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateCallbackSecret() {
  return randomBytes(32).toString('base64url');
}

export function hashCallbackSecret(secret) {
  return createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

export function verifyCallbackSecret(secret, expectedHash) {
  if (typeof secret !== 'string' || !secret || typeof expectedHash !== 'string') return false;
  const actual = Buffer.from(hashCallbackSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
