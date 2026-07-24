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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[B1] 首次调用：无 sessionId → spawn 参数不含 --resume，prompt 含 journey_id 锚点', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: mockClaudeOutput({ result: '收到，[TURN: chat]', session_id: 'sess-new-1' }),
      stderr: '',
    });

    const out = invokeAgent({
      content: '你好',
      sessionId: null,
      journeyId: 'j-1',
      gpId: null,
    });

    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).not.toContain('--resume');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    const promptArg = args[args.indexOf('-p') + 1];
    expect(promptArg).toContain('j-1');
    expect(promptArg).toContain('[TURN:');
    expect(out.sessionId).toBe('sess-new-1');
    expect(out.reply).toBe('收到，[TURN: chat]');
  });

  it('[B2] 续接调用：有 sessionId → spawn 参数含 --resume <sessionId>', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: mockClaudeOutput({ result: '继续，[TURN: chat]', session_id: 'sess-existing-1' }),
      stderr: '',
    });

    const out = invokeAgent({
      content: '接着说',
      sessionId: 'sess-existing-1',
      journeyId: 'j-1',
      gpId: 'gp-1',
    });

    const [, args] = spawnSync.mock.calls[0];
    const resumeIdx = args.indexOf('--resume');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(args[resumeIdx + 1]).toBe('sess-existing-1');
    // 续接调用不重复注入完整锚定文本，只传用户原始内容
    const promptArg = args[args.indexOf('-p') + 1];
    expect(promptArg).toBe('接着说');
    expect(out.sessionId).toBe('sess-existing-1');
  });

  it('[B2b] 续接调用若返回新 session_id（compact/rollover）→ 采用新值', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: mockClaudeOutput({ result: '好', session_id: 'sess-rolled-2' }),
      stderr: '',
    });

    const out = invokeAgent({
      content: '继续',
      sessionId: 'sess-existing-1',
      journeyId: 'j-1',
      gpId: null,
    });

    expect(out.sessionId).toBe('sess-rolled-2');
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
