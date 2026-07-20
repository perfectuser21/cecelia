import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractCodexSessions } from '../conversation-capture-codex.js';

function makeCodexHome(accounts) {
  // accounts: { '.codex': [entry, entry, ...], '.codex-team1': [...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  for (const [dirName, entries] of Object.entries(accounts)) {
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'history.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractCodexSessions', () => {
  it('同一文件里多个 session_id 正确分组', () => {
    const home = makeCodexHome({
      '.codex': [
        { session_id: 's1', ts: 1784500000, text: 's1 第一句' },
        { session_id: 's2', ts: 1784500010, text: 's2 第一句' },
        { session_id: 's1', ts: 1784500020, text: 's1 第二句' },
      ],
    });
    const sessions = extractCodexSessions(0, home);
    expect(sessions).toHaveLength(2);
    const s1 = sessions.find((s) => s.sessionId === 's1');
    expect(s1.source).toBe('conversation-codex');
    expect(s1.repo).toBe('.codex');
    expect(s1.turns.map((t) => t.text)).toEqual(['s1 第一句', 's1 第二句']);
    expect(s1.lastActivityMs).toBe(1784500020 * 1000);
  });

  it('跨多个账号目录（.codex/.codex-team1）聚合', () => {
    const home = makeCodexHome({
      '.codex': [{ session_id: 'a', ts: 1784500000, text: 'account main' }],
      '.codex-team1': [{ session_id: 'b', ts: 1784500000, text: 'account team1' }],
    });
    const sessions = extractCodexSessions(0, home);
    expect(sessions.map((s) => s.repo).sort()).toEqual(['.codex', '.codex-team1']);
  });

  it('没有 history.jsonl 的账号目录跳过，不抛异常', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-empty-'));
    fs.mkdirSync(path.join(home, '.codex-team3'), { recursive: true });
    expect(() => extractCodexSessions(0, home)).not.toThrow();
    expect(extractCodexSessions(0, home)).toEqual([]);
  });
});
