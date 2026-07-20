import fs from 'fs';
import path from 'path';
import os from 'os';

function findGrokPromptHistoryFiles(homeDir) {
  const sessionsDir = path.join(homeDir, '.grok', 'sessions');
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ projectDir: e.name, filePath: path.join(sessionsDir, e.name, 'prompt_history.jsonl') }))
    .filter((x) => fs.existsSync(x.filePath));
}

/**
 * 扫描 ~/.grok/sessions/<项目>/prompt_history.jsonl，按 session_id 分组。
 * 返回 [{sessionId, source, repo:<解码后的项目路径>, turns, lastActivityMs, lastEntryId}]
 */
export function extractGrokSessions(sinceMs, homeDir = os.homedir()) {
  const sessions = new Map();

  for (const { projectDir, filePath } of findGrokPromptHistoryFiles(homeDir)) {
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
      const text = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
      if (!text || !entry.session_id) return;
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

      const key = `${projectDir}:${entry.session_id}`;
      let session = sessions.get(key);
      if (!session) {
        let decodedRepo;
        try { decodedRepo = decodeURIComponent(projectDir); } catch { decodedRepo = projectDir; }
        session = {
          sessionId: entry.session_id,
          source: 'conversation-grok',
          repo: decodedRepo.slice(0, 100),
          turns: [],
          lastActivityMs: 0,
          lastEntryId: null,
        };
        sessions.set(key, session);
      }
      session.turns.push({ text, timestamp: entry.timestamp || null });
      if (ts && ts > session.lastActivityMs) {
        session.lastActivityMs = ts;
        session.lastEntryId = `${projectDir}:line${lineIndex}`;
      }
    });
  }

  return Array.from(sessions.values());
}
