import { describe, expect, it } from 'vitest';

import { claudeAdapter } from '../providers/claude.js';
import {
  codexAdapter,
  readCodexThreadId,
} from '../providers/codex.js';

const bundle = {
  contract_version: '1.0',
  run_id: '11111111-1111-4111-8111-111111111111',
  attempt_id: '22222222-2222-4222-8222-222222222222',
  hop: 1,
  phase: 'A_planning',
  role: 'planner',
  objective: 'Produce a plan from the supplied evidence.',
  skill: {
    name: 'harness-planner',
    version: '2.9.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: 'Follow this exact planning rubric.',
  },
  inputs: {
    task_id: 'task-1',
    sprint_dir: 'sprints/test',
    worktree_path: '/workspace',
    artifacts: [],
  },
  constraints: {
    read_only: true,
    fresh_session: true,
    timeout_seconds: 1800,
  },
  expected_output: 'harness-result/planner-v1',
};

describe('claudeAdapter', () => {
  it('fresh start 使用 JSON 输出且 auto 不写死模型', () => {
    const spec = claudeAdapter.start({
      bundle,
      execution: { claudeHome: '/tmp/claude-home', resultSchema: { type: 'object' } },
    });

    expect(spec).toMatchObject({
      provider: 'claude',
      command: 'claude',
      cwd: '/workspace',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-home' },
    });
    expect(spec.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema']));
    expect(spec.args).not.toContain('--model');
    expect(spec.args).not.toContain('--resume');
    expect(JSON.parse(spec.stdin).task_bundle).toEqual(bundle);
  });

  it('只有显式配置时才传 model，并可恢复同一 attempt session', () => {
    const fresh = claudeAdapter.start({ bundle, execution: { model: 'sonnet' } });
    expect(fresh.args).toEqual(expect.arrayContaining(['--model', 'sonnet']));

    const resumed = claudeAdapter.resume({
      attempt: { id: bundle.attempt_id, provider_session_id: 'session-1', task_bundle: bundle },
      input: 'Continue after the last heartbeat.',
      execution: { model: 'auto' },
    });
    expect(resumed.args).toEqual(expect.arrayContaining(['--resume', 'session-1']));
    expect(resumed.args).not.toContain('--model');
  });

  it('从 Claude JSON wrapper 规范化 result 与 session id', () => {
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
      attempt_id: bundle.attempt_id,
      status: 'completed',
      summary: 'done',
      provider_metadata: { provider: 'claude', session_id: 'claude-session' },
    });
  });
});

describe('codexAdapter', () => {
  it('fresh start 使用 JSONL/schema/last-message 且 auto 不写死模型', () => {
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
      command: 'codex',
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
    expect(spec.args).not.toContain('--model');
    expect(JSON.parse(spec.stdin).task_bundle).toEqual(bundle);
  });

  it('resume 使用原 attempt 的 thread，绝不跨角色创建隐式会话', () => {
    const spec = codexAdapter.resume({
      attempt: {
        id: bundle.attempt_id,
        provider_session_id: 'thread-1',
        task_bundle: bundle,
      },
      input: 'continue',
    });

    expect(spec.args).toEqual(expect.arrayContaining(['exec', 'resume', 'thread-1', '--json', '-']));
    expect(spec.args).not.toContain('--model');
    expect(() => codexAdapter.resume({ attempt: { id: bundle.attempt_id }, input: 'continue' }))
      .toThrow(/provider_session_id/);
  });

  it('解析 thread.started，并将 last message 规范化为 provider-neutral result', () => {
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-42' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message' } }),
    ].join('\n');
    expect(readCodexThreadId(stdout)).toBe('thread-42');

    const result = codexAdapter.normalizeResult({
      attempt: { id: bundle.attempt_id },
      raw: {
        stdout,
        lastMessage: JSON.stringify({ status: 'completed', summary: 'planned' }),
      },
    });
    expect(result).toMatchObject({
      attempt_id: bundle.attempt_id,
      status: 'completed',
      summary: 'planned',
      provider_metadata: { provider: 'codex', session_id: 'thread-42' },
    });
  });

  it('显式 model 才添加 --model', () => {
    const spec = codexAdapter.start({ bundle, execution: { model: 'gpt-5.4' } });
    expect(spec.args).toEqual(expect.arrayContaining(['--model', 'gpt-5.4']));
  });
});
