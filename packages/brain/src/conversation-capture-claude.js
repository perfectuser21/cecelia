import fs from 'fs';
import path from 'path';
import os from 'os';

export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects');

// Claude Code 以 role=user 写进 transcript、但不是真人打的字：命令回显、本地命令输出、
// 中断提示、上下文压缩后的续接摘要。新格式另有 isMeta / origin.kind 标记，老格式只能认前缀。
const INJECTED_PREFIXES = [
  '<task-notification>',
  '<command-name>',
  '<command-message>',
  '<local-command-',
  '<system-reminder>',
  '[Request interrupted',
  'This session is being continued from a previous conversation',
  'Base directory for this skill:',
];

function rawUserText(content) {
  if (typeof content === 'string') return content.trim();
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

function isRealUserText(entry) {
  if (entry?.message?.role !== 'user') return false;
  if (entry.isMeta === true) return false;
  const originKind = entry.origin && typeof entry.origin === 'object' ? entry.origin.kind : null;
  if (originKind && originKind !== 'human') return false;
  const content = entry.message.content;
  if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) return false;
  if (typeof content !== 'string' && !Array.isArray(content)) return false;
  const text = rawUserText(content);
  if (!text) return false;
  if (originKind === 'human') return true;
  return !INJECTED_PREFIXES.some((p) => text.startsWith(p));
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TASK_LINK_PATTERNS = [
  new RegExp(`--task-id[=\\s]+(${UUID})`, 'gi'),
  new RegExp(`/api/brain/tasks/(${UUID})/claim`, 'gi'),
];

/** 长寿会话（同一个 tmux 会话连着做好几天）只认最近这段时间内提到的任务 */
export const LINK_RECENCY_MS = 24 * 60 * 60 * 1000;

/** into: Map<taskId, 最近一次提到的时间 ms（无时间戳记 0）> */
function collectTaskIds(text, into, tsMs) {
  if (typeof text !== 'string' || !text) return;
  for (const re of TASK_LINK_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const id = m[1].toLowerCase();
      into.set(id, Math.max(into.get(id) ?? 0, tsMs || 0));
    }
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
  const tsMs = entry?.timestamp ? new Date(entry.timestamp).getTime() : 0;
  if (role === 'user') {
    if (isRealUserText(entry)) collectTaskIds(extractText(entry), links.primary, tsMs);
    return;
  }
  if (role === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== 'tool_use' || !block.input || typeof block.input !== 'object') continue;
      const target = block.name === 'Skill' ? links.primary : block.name === 'Bash' ? links.secondary : null;
      if (!target) continue;
      for (const v of Object.values(block.input)) collectTaskIds(typeof v === 'string' ? v : '', target, tsMs);
    }
  }
}

function recentIds(map, lastActivityMs) {
  const floor = lastActivityMs ? lastActivityMs - LINK_RECENCY_MS : -Infinity;
  return [...map].filter(([, ts]) => !ts || ts >= floor).map(([id]) => id);
}

function resolveLinkedTaskIds(links, lastActivityMs) {
  const primary = recentIds(links.primary, lastActivityMs);
  if (primary.length > 0) return primary;
  const secondary = recentIds(links.secondary, lastActivityMs);
  if (secondary.length > 0 && secondary.length <= MAX_BASH_CLAIM_LINKS) return secondary;
  return [];
}

function extractText(entry) {
  return rawUserText(entry.message.content);
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
      const links = { primary: new Map(), secondary: new Map() };

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
        linkedTaskIds: resolveLinkedTaskIds(links, lastActivityMs),
      });
    }
  }
  return sessions;
}
