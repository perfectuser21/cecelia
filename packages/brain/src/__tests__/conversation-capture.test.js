import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractUserTurns } from '../conversation-capture.js';

function writeFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-'));
  const filePath = path.join(dir, 'session.jsonl');
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return filePath;
}

describe('extractUserTurns', () => {
  it('保留 role=user 且 content 为字符串的真人文本', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '帮我看看这个 bug' } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('帮我看看这个 bug');
    expect(turns[0].timestamp).toBe('2026-07-20T01:00:00.000Z');
  });

  it('排除 role=user 但 content 是 tool_result 数组的注入消息', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u2', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: '命令输出...' }] } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(0);
  });

  it('排除 role=assistant 消息（含 tool_use 代码编辑块）', () => {
    const filePath = writeFixture([
      { type: 'assistant', uuid: 'u3', timestamp: '2026-07-20T01:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '我来改一下代码' }, { type: 'tool_use', name: 'Edit', input: {} }] } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(0);
  });

  it('格式损坏的行跳过，不抛异常', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-'));
    const filePath = path.join(dir, 'session.jsonl');
    fs.writeFileSync(filePath, '{not valid json\n' + JSON.stringify({ type: 'user', uuid: 'u4', timestamp: '2026-07-20T01:00:03.000Z', message: { role: 'user', content: '正常这条' } }) + '\n');
    expect(() => extractUserTurns(filePath, 0)).not.toThrow();
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('正常这条');
  });

  it('sinceMs 之前的轮次被跳过', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u5', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '早的一条' } },
      { type: 'user', uuid: 'u6', timestamp: '2026-07-20T02:00:00.000Z', message: { role: 'user', content: '晚的一条' } },
    ]);
    const sinceMs = new Date('2026-07-20T01:30:00.000Z').getTime();
    const turns = extractUserTurns(filePath, sinceMs);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('晚的一条');
  });

  it('dedupeKey 由文件名 + uuid 生成，同一文件同一 uuid 结果稳定', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'stable-uuid', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: 'x' } },
    ]);
    const first = extractUserTurns(filePath, 0);
    const second = extractUserTurns(filePath, 0);
    expect(first[0].dedupeKey).toBe(second[0].dedupeKey);
    expect(first[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('文件不存在时返回空数组，不抛异常', () => {
    expect(() => extractUserTurns('/tmp/definitely-not-exists-conv-capture.jsonl', 0)).not.toThrow();
    expect(extractUserTurns('/tmp/definitely-not-exists-conv-capture.jsonl', 0)).toEqual([]);
  });
});
