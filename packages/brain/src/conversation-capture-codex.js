import fs from 'fs';
import path from 'path';
import os from 'os';

function findCodexHistoryFiles(homeDir) {
  let entries;
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && /^\.codex($|-)/.test(e.name))
    .map((e) => ({ accountDir: e.name, filePath: path.join(homeDir, e.name, 'history.jsonl') }))
    .filter((x) => fs.existsSync(x.filePath));
}

/**
 * 扫描 ~/.codex 及 ~/.codex-<账号> 目录下的 history.jsonl（全局单文件，多 session 共用），按 session_id 分组。
 * 返回 [{sessionId, source, repo:<账号目录名>, turns, lastActivityMs, lastEntryId}]
 */
export function extractCodexSessions(sinceMs, homeDir = os.homedir()) {
  const sessions = new Map();

  for (const { accountDir, filePath } of findCodexHistoryFiles(homeDir)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < sinceMs) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').filter((l) => l.trim());

    lines.forEach((line, lineIndex) => {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text || !entry.session_id) return;
      const tsMs = typeof entry.ts === 'number' ? entry.ts * 1000 : null;

      const key = `${accountDir}:${entry.session_id}`;
      let session = sessions.get(key);
      if (!session) {
        session = {
          sessionId: entry.session_id,
          source: 'conversation-codex',
          repo: accountDir.slice(0, 100),
          turns: [],
          lastActivityMs: 0,
          lastEntryId: null,
        };
        sessions.set(key, session);
      }
      session.turns.push({ text, timestamp: tsMs ? new Date(tsMs).toISOString() : null });
      if (tsMs && tsMs > session.lastActivityMs) {
        session.lastActivityMs = tsMs;
        session.lastEntryId = `${accountDir}:line${lineIndex}`;
      }
    });
  }

  return Array.from(sessions.values());
}
