import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractClaudeSessions } from '../conversation-capture-claude.js';

function makeProjectsDir(files) {
  // files: { 'project-slug/session1.jsonl': [entry, entry, ...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-'));
  for (const [rel, entries] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractClaudeSessions', () => {
  it('一个 .jsonl 文件当一个 session，返回 sessionId/turns/lastActivityMs/lastEntryId', () => {
    const root = makeProjectsDir({
      'proj-a/019abc.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '第一句' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '回复' }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-07-20T01:00:02.000Z', message: { role: 'user', content: '第二句' } },
      ],
    });
    const sessions = extractClaudeSessions(0, root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('019abc');
    expect(sessions[0].source).toBe('conversation-claude');
    expect(sessions[0].repo).toBe('proj-a');
    expect(sessions[0].turns.map((t) => t.text)).toEqual(['第一句', '第二句']);
    expect(sessions[0].lastEntryId).toBe('u2');
    expect(sessions[0].lastActivityMs).toBe(new Date('2026-07-20T01:00:02.000Z').getTime());
  });

  it('排除 tool_result 数组消息与 assistant 消息（不产生 turns）', () => {
    const root = makeProjectsDir({
      'proj-b/019def.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }] } },
      ],
    });
    const sessions = extractClaudeSessions(0, root);
    expect(sessions).toHaveLength(0);
  });

  it('sinceMs 之后 mtime 未变化的文件被跳过（不返回该 session）', () => {
    const root = makeProjectsDir({
      'proj-c/019ghi.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '早期消息' } },
      ],
    });
    const farFuture = Date.now() + 3600_000;
    const sessions = extractClaudeSessions(farFuture, root);
    expect(sessions).toHaveLength(0);
  });

  it('目录不存在时返回空数组，不抛异常', () => {
    expect(() => extractClaudeSessions(0, '/tmp/definitely-not-exists-claude-projects')).not.toThrow();
    expect(extractClaudeSessions(0, '/tmp/definitely-not-exists-claude-projects')).toEqual([]);
  });
});
