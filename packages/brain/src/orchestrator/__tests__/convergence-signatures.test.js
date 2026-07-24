import { describe, expect, it } from 'vitest';
import {
  asStructuredJson,
  crashSignatureKey,
  failureSetKey,
  failureSignatureKey,
  generatorCrashSignature,
  normalizeFailureSet,
  normalizeFailureSignature,
} from '../convergence-signatures.js';

describe('convergence-signatures structured evidence', () => {
  it('parses JSON values without guessing from malformed natural language', () => {
    const object = { failure_set: ['lint'] };

    expect(asStructuredJson(object)).toBe(object);
    expect(asStructuredJson('{"failure_set":["test"]}')).toEqual({
      failure_set: ['test'],
    });
    expect(asStructuredJson('fixed lint, probably')).toBeNull();
    expect(asStructuredJson(null)).toBeNull();
  });

  it('canonicalizes a strict failure set for deterministic replay', () => {
    expect(normalizeFailureSignature([' test:b ', 'lint', 'lint'])).toEqual([
      'lint',
      'test:b',
    ]);
    expect(failureSignatureKey(['test:b', 'lint'])).toBe('["lint","test:b"]');
    expect(normalizeFailureSet(['test:b', 'lint'])).toEqual(['lint', 'test:b']);
    expect(failureSetKey(['test:b', 'lint'])).toBe('["lint","test:b"]');
  });

  it('rejects absent, empty, and partly unstructured failure sets', () => {
    expect(normalizeFailureSignature(null)).toBeNull();
    expect(normalizeFailureSignature([])).toBeNull();
    expect(normalizeFailureSignature(['lint', ' '])).toBeNull();
    expect(normalizeFailureSignature(['lint', { name: 'test' }])).toBeNull();
    expect(failureSignatureKey('lint failed')).toBeNull();
  });

  it('builds crash signatures only from structured server observations', () => {
    expect(generatorCrashSignature({
      code: 137,
      role: ' generator ',
    })).toEqual({
      role: 'generator',
      error_code: 'exit_137',
      failure_class: 'runtime_crash',
    });
    expect(generatorCrashSignature({
      code: 1,
      auth_failed: true,
    })).toEqual({
      role: 'generator',
      error_code: 'auth_failed',
      failure_class: 'auth_failure',
    });
    expect(generatorCrashSignature({ code: 0, feedback: 'looks bad' })).toBeNull();
    expect(generatorCrashSignature('generator crashed')).toBeNull();
  });

  it('keys complete crash signatures and rejects incomplete ones', () => {
    expect(crashSignatureKey({
      role: 'generator',
      error_code: 'exit_137',
      failure_class: 'runtime_crash',
    })).toBe(
      '{"role":"generator","error_code":"exit_137","failure_class":"runtime_crash"}',
    );
    expect(crashSignatureKey({
      role: 'generator',
      error_code: 'exit_137',
    })).toBeNull();
  });
});
