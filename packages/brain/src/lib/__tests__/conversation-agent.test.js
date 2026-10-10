/**
 * conversation-agent.test.js — PR2/4 claude spawn/resume 调用层单测
 *
 * [BEHAVIOR] B1 — 首次调用（无 session_id）：spawn 不带 --resume，prompt 含 journey_id 锚点 + 协议要求
 * [BEHAVIOR] B2 — 续接调用（有 session_id）：spawn 带 --resume <session_id>
 * [BEHAVIOR] B3 — 解析 claude --output-format json 输出：提取 result 文本 + session_id
 * [BEHAVIOR] B4 — 解析协议标记：[TURN: chat] / [TURN: decision_saved=<uuid>] / [TURN: pending_user]
 * [BEHAVIOR] B5 — 协议标记缺失时 turnMarker 为 null（不报错，留给上层决定）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'node:child_process';
import { invokeAgent, parseAgentOutput, parseTurnMarker } from '../conversation-agent.js';

function mockClaudeOutput({ result, session_id }) {
  return JSON.stringify({ type: 'result', subtype: 'success', result, session_id }) + '\n';
}

describe('conversation-agent — invokeAgent', () => {
  // 原 [B1] 首次 spawn 无 --resume + 锚点 / [B2] 续接 --resume / [B2b] 采用新 session_id：
  // 已随 Claude 通道退役删除（任务 76a160b3）
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[B1] 首次调用：抛 claude_channel_retired，不 spawn 任何进程', () => {
    expect(() => invokeAgent({ content: '你好', sessionId: null, journeyId: 'j-1', gpId: null }))
      .toThrow(expect.objectContaining({ code: 'claude_channel_retired' }));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('[B2] 续接调用：同样抛 claude_channel_retired，不 --resume', () => {
    expect(() => invokeAgent({ content: '接着说', sessionId: 'sess-existing-1', journeyId: 'j-1', gpId: 'gp-1' }))
      .toThrow(/claude_channel_retired/);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

describe('conversation-agent — parseAgentOutput', () => {
  it('[B3] 从 claude --output-format json 输出提取 result 文本 + session_id', () => {
    const stdout = mockClaudeOutput({ result: '文本回复', session_id: 'sid-abc' });
    const parsed = parseAgentOutput(stdout);
    expect(parsed.reply).toBe('文本回复');
    expect(parsed.sessionId).toBe('sid-abc');
  });

  it('[B3b] 多行/流式输出仍能取到最后一个 JSON 对象', () => {
    const stdout =
      '{"type":"system","subtype":"init"}\n' +
      mockClaudeOutput({ result: '最终回复', session_id: 'sid-final' });
    const parsed = parseAgentOutput(stdout);
    expect(parsed.reply).toBe('最终回复');
    expect(parsed.sessionId).toBe('sid-final');
  });
});

describe('conversation-agent — parseTurnMarker', () => {
  it('[B4] 解析 [TURN: chat]', () => {
    expect(parseTurnMarker('这是回复 [TURN: chat]')).toBe('chat');
  });

  it('[B4] 解析 [TURN: decision_saved=<uuid>]', () => {
    const marker = parseTurnMarker(
      '已存 [TURN: decision_saved=123e4567-e89b-12d3-a456-426614174000]'
    );
    expect(marker).toBe('decision_saved=123e4567-e89b-12d3-a456-426614174000');
  });

  it('[B4] 解析 [TURN: pending_user]', () => {
    expect(parseTurnMarker('等你确认 [TURN: pending_user]')).toBe('pending_user');
  });

  it('[B5] 无协议标记 → 返回 null', () => {
    expect(parseTurnMarker('没有标记的普通回复')).toBeNull();
  });
});
