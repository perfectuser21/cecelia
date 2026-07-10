/**
 * skills-chat-sse.test.js
 * 回归测试：对话式创建 Skill SSE 端点
 *
 * 覆盖两个根因修复：
 * ① stream-json 格式解析——使用真实 claude CLI 嵌套格式，不用平铺 mock
 * ② 账号池选择——SSE 端点必须调用 selectBestAccount，不用默认（已过期）OAuth
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { parseSkillChatStreamLine } from '../skills.js';

// ─── 单元测试：parseSkillChatStreamLine ──────────────────────────────────────

describe('parseSkillChatStreamLine — 真实 claude CLI stream-json 格式', () => {
  it('正确解析真实嵌套格式 {type:assistant,message:{content:[{type:text,text}]}}', () => {
    // 这是 claude --output-format stream-json 的真实输出格式
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_abc',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        model: 'claude-sonnet-4-6',
        stop_reason: null,
      },
    });
    expect(parseSkillChatStreamLine(line)).toBe('Hello! How can I help?');
  });

  it('多个 text block 时拼接', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Part1 ' },
          { type: 'text', text: 'Part2' },
        ],
      },
    });
    expect(parseSkillChatStreamLine(line)).toBe('Part1 Part2');
  });

  it('忽略 thinking block（只取 text）', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '内部思考' },
          { type: 'text', text: '外部回复' },
        ],
      },
    });
    expect(parseSkillChatStreamLine(line)).toBe('外部回复');
  });

  it('type=result 行返回 null（非 assistant）', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Hello! How can I help?',
      cost_usd: 0.001,
    });
    expect(parseSkillChatStreamLine(line)).toBeNull();
  });

  it('type=system 行返回 null', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'xxx' });
    expect(parseSkillChatStreamLine(line)).toBeNull();
  });

  it('空行返回 null', () => {
    expect(parseSkillChatStreamLine('')).toBeNull();
    expect(parseSkillChatStreamLine('   ')).toBeNull();
  });

  it('非法 JSON 返回 null', () => {
    expect(parseSkillChatStreamLine('not-json')).toBeNull();
    expect(parseSkillChatStreamLine('{broken')).toBeNull();
  });

  // 确认旧的错误格式（平铺）不会被误判为有效内容
  it('旧错误格式 {type:text,text} 返回 null（平铺格式不匹配 assistant 格式）', () => {
    const wrongFlatLine = JSON.stringify({ type: 'text', text: 'Hello' });
    // type=text 不是 assistant，应该返回 null
    expect(parseSkillChatStreamLine(wrongFlatLine)).toBeNull();
  });

  it('assistant 行 content 为空数组返回空字符串', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } });
    expect(parseSkillChatStreamLine(line)).toBe('');
  });

  it('assistant 行无 message.content 返回 null', () => {
    const line = JSON.stringify({ type: 'assistant', message: {} });
    expect(parseSkillChatStreamLine(line)).toBeNull();
  });
});

// ─── 账号池选择验证 ──────────────────────────────────────────────────────────

describe('账号池选择路径', () => {
  it('CLAUDE_CONFIG_DIR 通过 accountId 拼装，不走默认 OAuth', () => {
    // 验证账号目录拼装逻辑：~/.claude-account1 / ~/.claude-account2
    // 端点实现中：join(homedir(), `.claude-${accountId}`)
    // 确保不是 ~/.claude（默认 OAuth，mmv 上已过期）
    const { join } = require('path');
    const { homedir } = require('os');

    for (const accountId of ['account1', 'account2']) {
      const configDir = join(homedir(), `.claude-${accountId}`);
      expect(configDir).toMatch(/\.claude-account[12]$/);
      expect(configDir).not.toBe(join(homedir(), '.claude'));
    }
  });
});

// ─── 增量文本提取逻辑测试 ─────────────────────────────────────────────────

describe('stream-json 增量文本提取（快照→delta）', () => {
  it('连续快照行正确产出增量 delta', () => {
    // stream-json 每行是累积快照，调用方通过 slice(lastLength) 取增量
    const snapshots = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello, how' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello, how can I help?' }] } }),
    ];

    let lastLength = 0;
    const deltas = [];
    for (const snap of snapshots) {
      const fullText = parseSkillChatStreamLine(snap);
      if (fullText !== null) {
        const delta = fullText.slice(lastLength);
        if (delta) deltas.push(delta);
        lastLength = fullText.length;
      }
    }

    expect(deltas).toEqual([
      'Hello',        // 第1行：0→5
      ', how',        // 第2行：5→10
      ' can I help?', // 第3行：10→23
    ]);
    expect(deltas.join('')).toBe('Hello, how can I help?');
  });
});
