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

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TASK_LINK_PATTERNS = [
  new RegExp(`--task-id[=\\s]+(${UUID})`, 'gi'),
  new RegExp(`/api/brain/tasks/(${UUID})/claim`, 'gi'),
];

function collectTaskIds(text, into) {
  if (typeof text !== 'string' || !text) return;
  for (const re of TASK_LINK_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) into.add(m[1].toLowerCase());
  }
}

/** Bash 里 claim 过的任务超过这个数 → 视为编排会话（替别人认领派发），不当本会话的任务 */
export const MAX_BASH_CLAIM_LINKS = 3;

/**
 * 会话关联的 Brain 任务，分两档：
 *   primary   = 真人打的字 + Skill 调用参数里的 `--task-id <uuid>`（如 `/dev --task-id X`）——本会话就是在做它
 *   secondary = Bash 工具调用里的 `tasks/<uuid>/claim` / `--task-id`（无 primary 时才用，且 ≤3 个）
 * 不认：tool_result 回显（grep/日志里常混着别的任务 id）、Agent/Task 等派给子代理的 prompt
 * （那是别的执行体在做的任务，各自收尾）。认错的代价是把摘要并进无关任务，宁缺毋滥。
 */
function collectEntryTaskIds(entry, links) {
  const role = entry?.message?.role;
  const content = entry?.message?.content;
  if (role === 'user') {
    if (isRealUserText(entry)) collectTaskIds(extractText(entry), links.primary);
    return;
  }
  if (role === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== 'tool_use' || !block.input || typeof block.input !== 'object') continue;
      const target = block.name === 'Skill' ? links.primary : block.name === 'Bash' ? links.secondary : null;
      if (!target) continue;
      for (const v of Object.values(block.input)) collectTaskIds(typeof v === 'string' ? v : '', target);
    }
  }
}

function resolveLinkedTaskIds(links) {
  if (links.primary.size > 0) return [...links.primary];
  if (links.secondary.size > 0 && links.secondary.size <= MAX_BASH_CLAIM_LINKS) return [...links.secondary];
  return [];
}

function extractText(entry) {
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim();
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * 扫描 ~/.claude/projects 下每个子目录内的 .jsonl 文件，每个文件当一个 session。
 * 返回 [{sessionId, source, repo, turns:[{text,timestamp}], lastActivityMs, lastEntryId}]
 *
 * 排除 `-private-tmp-` 前缀目录：Brain 无头 LLM 调用（含本模块自身的 Haiku 摘要
 * 调用）的 cwd 落在 /private/tmp 下，projects 目录名按 cwd 编码，role='user' 过滤
 * 挡不住这类机器写的字。不排除会导致摘要器把自己调用 Haiku 产生的新会话再捕获一遍，
 * 形成自我喂养循环（见 2026-07-22 事故复盘）。
 */
export function extractClaudeSessions(sinceMs, projectsDir = CLAUDE_PROJECTS_DIR) {
  const sessions = [];
  if (!fs.existsSync(projectsDir)) return sessions;

  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('-private-tmp-'));
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
      // entrypoint：cli = 交互式有头会话（TTY），sdk-cli = 无头 claude -p；未登记出处时据此判真人
      let entrypoint = null;
      const links = { primary: new Set(), secondary: new Set() };

      lines.forEach((line, lineIndex) => {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        if (!entrypoint && typeof entry.entrypoint === 'string') entrypoint = entry.entrypoint;
        collectEntryTaskIds(entry, links);
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
        entrypoint,
        linkedTaskIds: resolveLinkedTaskIds(links),
      });
    }
  }
  return sessions;
}
