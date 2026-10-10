import { describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';

const bundle = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  inputs: { worktree_path: '/workspace' },
};
const directive = {
  schema: 'commander-directive/v1',
  run_id: '11111111-1111-4111-8111-111111111111',
  event_cursor: 9,
  action: 'continue_default',
  reason: 'The fresh Kernel decision remains legal.',
  evidence_refs: ['event:9'],
};

describe('claudeAdapter', () => {
  // 原「start 生成 claude -p --session-id 命令 / resume 生成 --resume 命令」两条：
  // 已随 Claude 通道退役删除（任务 76a160b3），改为抛 claude_channel_retired；normalizeResult 保留
  it('start 抛 claude_channel_retired，不生成任何 claude 命令', () => {
    expect(() => claudeAdapter.start({
      bundle,
      execution: { claudeHome: '/tmp/claude-home', resultSchema: { type: 'object' } },
    })).toThrow(expect.objectContaining({ code: 'claude_channel_retired' }));
  });

  it('resume 抛 claude_channel_retired；历史 attempt 的结构化结果仍可 normalize', () => {
    expect(() => claudeAdapter.resume({
      attempt: {
        id: bundle.attempt_id,
        provider: 'claude',
        provider_session_id: 'claude-session',
        task_bundle: bundle,
      },
      input: 'continue',
    })).toThrow(/claude_channel_retired/);

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

  it('normalizes a direct Commander Directive with Claude session identity', () => {
    expect(claudeAdapter.normalizeResult({
      attempt: {
        id: bundle.attempt_id,
        task_bundle: { expected_output: 'commander-directive/v1' },
      },
      raw: {
        stdout: JSON.stringify({
          session_id: 'claude-commander',
          structured_output: directive,
        }),
      },
    })).toMatchObject({
      status: 'completed',
      decision: directive,
      provider_metadata: {
        provider: 'claude',
        session_id: 'claude-commander',
      },
    });
  });
});
