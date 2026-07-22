import { describe, expect, it } from 'vitest';

import {
  addExplicitModel,
  assertResumeAttempt,
  buildProviderPrompt,
  normalizeProviderResult,
  parseJsonValue,
} from './shared.js';

describe('provider shared contract', () => {
  it('serializes the immutable task bundle and continuation into the provider prompt', () => {
    const bundle = { attempt_id: 'attempt-1', role: 'evaluator' };
    expect(JSON.parse(buildProviderPrompt(bundle, 'continue'))).toMatchObject({
      task_bundle: bundle,
      continuation: 'continue',
    });
  });

  it('parses JSON and rejects empty or malformed provider output', () => {
    expect(parseJsonValue('{"status":"completed"}', 'result')).toEqual({ status: 'completed' });
    expect(parseJsonValue({ status: 'completed' }, 'result')).toEqual({ status: 'completed' });
    expect(() => parseJsonValue('', 'result')).toThrow(/empty/);
    expect(() => parseJsonValue('{', 'result')).toThrow(/not valid JSON/);
  });

  it('normalizes defaults and pins provider/session metadata', () => {
    const result = normalizeProviderResult({
      attempt: { id: 'attempt-1' },
      payload: { status: 'completed' },
      provider: 'codex',
      sessionId: 'thread-1',
    });
    expect(result).toMatchObject({
      attempt_id: 'attempt-1',
      status: 'completed',
      artifacts: [],
      checks: [],
      provider_metadata: { provider: 'codex', session_id: 'thread-1' },
    });
  });

  it('adds only explicit models and fences cross-provider resume', () => {
    const args = [];
    addExplicitModel(args, 'auto');
    addExplicitModel(args, 'gpt-5.4');
    expect(args).toEqual(['--model', 'gpt-5.4']);

    expect(() => assertResumeAttempt({}, 'codex')).toThrow(/provider_session_id/);
    expect(() => assertResumeAttempt(
      { provider_session_id: 'session-1', provider: 'claude' },
      'codex',
    )).toThrow(/provider_session_mismatch/);
    expect(() => assertResumeAttempt(
      { provider_session_id: 'session-1', provider: 'codex' },
      'codex',
    )).not.toThrow();
  });
});
