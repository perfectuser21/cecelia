import { describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';

const bundle = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  inputs: { worktree_path: '/workspace' },
};

describe('claudeAdapter', () => {
  it('starts a fresh structured-output session in the assigned account home', () => {
    const spec = claudeAdapter.start({
      bundle,
      execution: { claudeHome: '/tmp/claude-home', resultSchema: { type: 'object' } },
    });

    expect(spec).toMatchObject({
      provider: 'claude',
      cwd: '/workspace',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-home' },
    });
    expect(spec.args).toEqual(expect.arrayContaining([
      '-p', '--output-format', 'json', '--json-schema', '--session-id', bundle.attempt_id,
    ]));
    expect(spec.args).not.toContain('--model');
  });

  it('resumes the persisted session and normalizes its structured result', () => {
    const resumed = claudeAdapter.resume({
      attempt: {
        id: bundle.attempt_id,
        provider: 'claude',
        provider_session_id: 'claude-session',
        task_bundle: bundle,
      },
      input: 'continue',
    });
    expect(resumed.args).toEqual(expect.arrayContaining(['--resume', 'claude-session']));
    expect(resumed.args).not.toContain('--session-id');

    const result = claudeAdapter.normalizeResult({
      attempt: { id: bundle.attempt_id },
      raw: {
        stdout: JSON.stringify({
          session_id: 'claude-session',
          result: JSON.stringify({ status: 'completed', summary: 'done' }),
        }),
      },
    });
    expect(result).toMatchObject({
      status: 'completed',
      summary: 'done',
      provider_metadata: { provider: 'claude', session_id: 'claude-session' },
    });
  });
});
