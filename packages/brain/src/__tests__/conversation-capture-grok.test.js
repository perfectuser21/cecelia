import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractGrokSessions } from '../conversation-capture-grok.js';

function makeGrokHome(projects) {
  // projects: { '%2FUsers%2Fadministrator%2Fperfect21%2Fcecelia': [entry, ...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
  const sessionsDir = path.join(root, '.grok', 'sessions');
  for (const [projectDir, entries] of Object.entries(projects)) {
    const dir = path.join(sessionsDir, projectDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt_history.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractGrokSessions', () => {
  it('按 session_id 分组，repo 用解码后的项目路径', () => {
    const home = makeGrokHome({
      '%2FUsers%2Fadministrator%2Fperfect21%2Fcecelia': [
        { session_id: 'g1', timestamp: '2026-07-20T01:00:00.000Z', prompt: '任务描述' },
      ],
    });
    const sessions = extractGrokSessions(0, home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe('conversation-grok');
    expect(sessions[0].repo).toBe('/Users/administrator/perfect21/cecelia');
    expect(sessions[0].turns[0].text).toBe('任务描述');
  });

  it('sessions 目录不存在时返回空数组，不抛异常', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-empty-'));
    expect(() => extractGrokSessions(0, home)).not.toThrow();
    expect(extractGrokSessions(0, home)).toEqual([]);
  });
});
