import { describe, expect, it } from 'vitest';

import { codexAdapter, readCodexThreadId } from './codex.js';

const bundle = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  inputs: { worktree_path: '/workspace' },
};

describe('codexAdapter', () => {
  it('starts with JSON events, an output schema, and a last-message result file', () => {
    const spec = codexAdapter.start({
      bundle,
      execution: {
        codexHome: '/tmp/codex-home',
        resultSchemaPath: '/tmp/result.schema.json',
        resultPath: '/tmp/result.json',
      },
    });

    expect(spec).toMatchObject({
      provider: 'codex',
      cwd: '/workspace',
      env: { CODEX_HOME: '/tmp/codex-home' },
      output: {
        format: 'jsonl',
        result_path: '/tmp/result.json',
        schema_path: '/tmp/result.schema.json',
      },
    });
    expect(spec.args).toEqual(expect.arrayContaining([
      'exec', '--json', '--output-schema', '/tmp/result.schema.json',
      '--output-last-message', '/tmp/result.json', '-',
    ]));
  });

  it('resumes the original thread and extracts its id from real JSONL events', () => {
    const resumed = codexAdapter.resume({
      attempt: {
        id: bundle.attempt_id,
        provider: 'codex',
        provider_session_id: 'thread-42',
        task_bundle: bundle,
      },
      input: 'continue',
    });
    expect(resumed.args).toEqual(expect.arrayContaining(['exec', 'resume', 'thread-42']));

    const stdout = [
      'diagnostic text',
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-42' }),
    ].join('\n');
    expect(readCodexThreadId(stdout)).toBe('thread-42');
    expect(codexAdapter.normalizeResult({
      attempt: { id: bundle.attempt_id },
      raw: { stdout, lastMessage: JSON.stringify({ status: 'completed', summary: 'done' }) },
    })).toMatchObject({
      status: 'completed',
      provider_metadata: { provider: 'codex', session_id: 'thread-42' },
    });
  });

  it('disables every execution tool and user extension for a canary invocation', () => {
    const spec = codexAdapter.start({
      bundle,
      execution: { canary: true },
    });

    expect(spec.canary).toBe(true);
    expect(spec.args).toEqual(expect.arrayContaining([
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--disable', 'shell_tool',
      '--disable', 'unified_exec',
      '--disable', 'code_mode_host',
      '--disable', 'browser_use',
      '--disable', 'apps',
      '--disable', 'plugins',
    ]));
  });
});
