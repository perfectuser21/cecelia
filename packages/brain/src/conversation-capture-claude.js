import fs from 'fs';
import path from 'path';
import os from 'os';

export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects');

function isRealUserText(entry) {
  if (entry?.message?.role !== 'user') return false;
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    const hasToolResult = content.some((b) => b?.type === 'tool_result');
    if (hasToolResult) return false;
    const textBlocks = content.filter((b) => b?.type === 'text' && b.text?.trim());
    return textBlocks.length > 0;
  }
  return false;
}

function extractText(entry) {
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim();
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * 扫描 ~/.claude/projects 下每个子目录内的 .jsonl 文件，每个文件当一个 session。
 * 返回 [{sessionId, source, repo, turns:[{text,timestamp}], lastActivityMs, lastEntryId}]
 */
export function extractClaudeSessions(sinceMs, projectsDir = CLAUDE_PROJECTS_DIR) {
  const sessions = [];
  if (!fs.existsSync(projectsDir)) return sessions;

  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return sessions;
  }

  for (const dir of projectDirs) {
    const dirPath = path.join(projectsDir, dir.name);
    let files;
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(dirPath, file);
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
      const turns = [];
      let lastActivityMs = 0;
      let lastEntryId = null;

      lines.forEach((line, lineIndex) => {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        if (!isRealUserText(entry)) return;
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;
        if (ts && ts > lastActivityMs) {
          lastActivityMs = ts;
          lastEntryId = entry.uuid || `line${lineIndex}`;
        }
        turns.push({ text: extractText(entry), timestamp: entry.timestamp || null });
      });

      if (turns.length === 0) continue;
      sessions.push({
        sessionId: file.replace(/\.jsonl$/, ''),
        source: 'conversation-claude',
        repo: dir.name.slice(0, 100),
        turns,
        lastActivityMs,
        lastEntryId,
      });
    }
  }
  return sessions;
}
