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

  it('排除 -private-tmp- 前缀目录（Brain 无头 LLM 调用会话，非真人交互），真实项目目录正常保留', () => {
    const root = makeProjectsDir({
      '-private-tmp-cecelia-llm/019headless.jsonl': [
        { type: 'user', uuid: 'h1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: 'Brain 派发的无头 prompt' } },
      ],
      '-Users-administrator-perfect21-cecelia/019real.jsonl': [
        { type: 'user', uuid: 'r1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: 'Alex 真人交互' } },
      ],
    });
    const sessions = extractClaudeSessions(0, root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].repo).toBe('-Users-administrator-perfect21-cecelia');
    expect(sessions[0].turns.map((t) => t.text)).toEqual(['Alex 真人交互']);
  });

  it('记录 entrypoint（cli=交互有头，sdk-cli=无头），用于未登记出处时判定真人会话', () => {
    const root = makeProjectsDir({
      'proj-e/019cli.jsonl': [
        { type: 'user', uuid: 'u1', entrypoint: 'cli', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '有头' } },
      ],
      'proj-e/019sdk.jsonl': [
        { type: 'user', uuid: 'u1', entrypoint: 'sdk-cli', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '无头' } },
      ],
      'proj-e/019none.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '老格式' } },
      ],
    });
    const byId = Object.fromEntries(extractClaudeSessions(0, root).map((s) => [s.sessionId, s]));
    expect(byId['019cli'].entrypoint).toBe('cli');
    expect(byId['019sdk'].entrypoint).toBe('sdk-cli');
    expect(byId['019none'].entrypoint).toBeNull();
  });

  it('linkedTaskIds：只从真人文本与 assistant 工具调用里认 --task-id / tasks/<id>/claim，不认 tool_result 回显', () => {
    const A = 'c8b27bc5-dd78-4139-aaf8-4060ff11c6bf';
    const B = '11111111-2222-4333-8444-555555555555';
    const C = '99999999-8888-4777-8666-555555555555';
    const root = makeProjectsDir({
      'proj-f/019link.jsonl': [
        { type: 'user', uuid: 'u1', entrypoint: 'cli', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: `/dev --task-id ${A}` } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'assistant', content: [
          { type: 'tool_use', name: 'Bash', input: { command: `curl -s -X POST localhost:5221/api/brain/tasks/${B}/claim -d '{}'` } },
          { type: 'tool_use', name: 'Skill', input: { skill: 'dev', args: `--task-id ${A}` } },
        ] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-07-20T01:00:02.000Z', message: { role: 'user', content: [
          { type: 'tool_result', content: `grep 输出：--task-id ${C} 以及 /tasks/${C}/claim` },
        ] } },
      ],
    });
    const [session] = extractClaudeSessions(0, root);
    expect(session.linkedTaskIds.sort()).toEqual([A, B].sort());
  });
});
