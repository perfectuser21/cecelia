import { describe, expect, it } from 'vitest';

import { grokAdapter } from './grok.js';

const bundle = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  inputs: { worktree_path: '/workspace' },
};

describe('grokAdapter', () => {
  it('starts with approval, schema, session, and assigned account home', () => {
    const spec = grokAdapter.start({
      bundle,
      execution: { grokHome: '/tmp/grok-home', model: 'grok-code-fast-1' },
    });

    expect(spec).toMatchObject({
      provider: 'grok',
      cwd: '/workspace',
      env: { GROK_HOME: '/tmp/grok-home' },
    });
    expect(spec.args).toEqual(expect.arrayContaining([
      '--always-approve', '--output-format', 'json', '--json-schema',
      '--session-id', bundle.attempt_id, '--model', 'grok-code-fast-1',
    ]));
  });

  it('uses the container workspace for a path-free Fleet bundle', () => {
    const spec = grokAdapter.start({
      bundle: {
        ...bundle,
        inputs: {
          execution_surface: 'fleet-worker',
          workspace_spec: {
            mode: 'read-write',
          },
        },
      },
    });

    expect(spec.cwd).toBe('/workspace');
    expect(spec.args).toEqual(expect.arrayContaining(['--cwd', '/workspace']));
    expect(spec.args).not.toContain(null);
    expect(spec.args).not.toContain(undefined);
  });

  it('resumes the original session and normalizes a Grok JSON wrapper', () => {
    const resumed = grokAdapter.resume({
      attempt: {
        id: bundle.attempt_id,
        provider: 'grok',
        provider_session_id: 'grok-session',
        task_bundle: bundle,
      },
      input: 'continue',
    });
    expect(resumed.args).toEqual(expect.arrayContaining(['--resume', 'grok-session']));
    expect(resumed.args).not.toContain('--session-id');

    const result = grokAdapter.normalizeResult({
      attempt: { id: bundle.attempt_id },
      raw: {
        stdout: JSON.stringify({
          session_id: 'grok-session',
          result: { status: 'completed', summary: 'verified' },
        }),
      },
    });
    expect(result).toMatchObject({
      status: 'completed',
      summary: 'verified',
      provider_metadata: { provider: 'grok', session_id: 'grok-session' },
    });
  });

  it('normalizes the camelCase structured output returned by Grok 0.2.106', () => {
    const result = grokAdapter.normalizeResult({
      attempt: { id: bundle.attempt_id },
      raw: {
        stdout: JSON.stringify({
          stopReason: 'EndTurn',
          sessionId: 'grok-session-real',
          structuredOutput: { status: 'completed', summary: 'reviewed' },
        }),
      },
    });

    expect(result).toMatchObject({
      status: 'completed',
      summary: 'reviewed',
      provider_metadata: { provider: 'grok', session_id: 'grok-session-real' },
    });
  });
});
