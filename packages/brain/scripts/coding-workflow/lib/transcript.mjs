// Claude stream-json / Codex exec --json 原生对话记录：提取实际执行过的 Bash 命令及其结果，核对 04-evidence 是否有据。
import path from 'node:path';
import { matchesShellEvidence } from './shell-command.mjs';

const OUTPUT_LINES_CHECKED = 5;

const squashSpace = (text) => String(text).replace(/\s+/g, ' ').trim();

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
}

/** stdout 里能解析为 JSON 的事件（每行一个，非 JSON 行忽略）。 */
function events(stdout) {
  const out = [];
  for (const line of String(stdout).split('\n')) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // 非 JSON 行（日志等）
    }
  }
  return out;
}

/**
 * 会话自身的错误文本：出错的 `type:"result"` 事件（is_error 或 subtype 非 success）的 subtype 与 result，
 * 以及 `type:"error"` / Codex `type:"turn.failed"` 事件的消息。不含 tool_result 里的业务输出，供鉴权判定使用。
 */
export function claudeOwnErrorText(stdout) {
  const parts = [];
  for (const event of events(stdout)) {
    if (event?.type === 'result' && (event.is_error === true || (event.subtype && event.subtype !== 'success'))) {
      parts.push(String(event.subtype ?? ''), typeof event.result === 'string' ? event.result : '');
    } else if (event?.type === 'error' || event?.type === 'turn.failed') {
      parts.push(String(event.error?.message ?? event.message ?? ''));
    }
  }
  return parts.filter(Boolean).join('\n');
}

/** 原生会话费用；Codex JSONL 只给 token usage，美元费用未知，不估价。 */
export function sessionCostUsd(stdout) {
  const rows = events(stdout);
  if (rows.some((event) => /^(thread|turn|item)\./.test(event?.type ?? ''))) return null;
  let cost = 0; // 保留旧 Claude 缺计费事件的兼容口径；Codex 空输出由 provider 显式给 null。
  for (const event of rows) {
    if (event?.type === 'result' && Number.isFinite(event.total_cost_usd)) cost = event.total_cost_usd;
  }
  return cost;
}

/** null 表示有会话但美元费用未知；不能将已知小计冒充全链总额。undefined 表示没有该项。 */
export function sumCostUsd(...costs) {
  if (costs.some((cost) => cost === null || (cost !== undefined && !Number.isFinite(cost)))) return null;
  return Math.round(costs.reduce((total, cost) => total + (cost ?? 0), 0) * 10000) / 10000;
}

export const costText = (cost) => cost === null ? '未知（未提供美元计费）' : `$${cost}`;

/** stdout（每行一个 JSON 事件，非 JSON 行忽略）→ 按出现顺序的 [{ command, result }]；没有结果的命令 result 为 ''。 */
export function bashExecutions(stdout) {
  const runs = [];
  const byId = new Map();
  for (const event of events(stdout)) {
    const item = event?.item;
    if (['item.started', 'item.completed'].includes(event?.type)
      && item?.type === 'command_execution' && typeof item.command === 'string') {
      const key = `codex:${item.id}`;
      let run = item.id ? byId.get(key) : null;
      if (!run) {
        run = { command: item.command, result: '', provider: 'codex', completed: false, exitCode: null };
        runs.push(run);
        if (item.id) byId.set(key, run);
      }
      if (event.type === 'item.completed') {
        // 完成事件的命令、输出和退出码必须一起采信，不能嫁接 started 的命令。
        run.command = item.command;
        run.result = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
        run.completed = true;
        run.exitCode = Number.isInteger(item.exit_code) ? item.exit_code : null;
      }
      continue;
    }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string') {
        const run = { command: block.input.command, result: '' };
        runs.push(run);
        byId.set(block.id, run);
      } else if (block?.type === 'tool_result' && byId.has(block.tool_use_id)) {
        byId.get(block.tool_use_id).result = resultText(block.content);
      }
    }
  }
  return runs;
}

const CD_PREFIX_RE = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/;

/** dir（绝对路径或相对 worktree）解析后是否落在某个 worktree 根内（含根本身）。 */
function insideWorktree(dir, roots) {
  return roots.some((root) => {
    const resolved = path.resolve(root, dir);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  });
}

/**
 * 真实 claude 常在 worktree 里直接执行命令，写证据时再补上 `cd <worktree 内目录> && ` 前缀（ea2feb66 实测）。
 * 给了 worktree（字符串或数组）且前缀目录落在其中时去掉该前缀；其余情况原样返回。
 */
function stripWorktreeCd(command, worktree) {
  const roots = [worktree].flat().filter((r) => typeof r === 'string' && r).map((r) => path.resolve(r));
  const m = roots.length > 0 ? CD_PREFIX_RE.exec(command) : null;
  if (!m) return command;
  const dir = m[1].replace(/^["']|["']$/g, '');
  return !/[\\$`]/.test(dir) && insideWorktree(dir, roots) ? command.slice(m[0].length) : command;
}

const ELLIPSIS_RE = /\.{3,}|…+/;

/**
 * 一行输出摘录是否出自真实结果：没有省略号 → 必须是子串；带 `...`/`…` 省略长行中间 → 每段（去首尾空白、非空）
 * 都要按顺序出现在结果里（真实 QA 实测：健康检查是一行很长的 JSON）。整行只有省略号不算证据。
 */
function lineInResult(line, result) {
  if (!ELLIPSIS_RE.test(line)) return result.includes(line);
  const parts = line.split(ELLIPSIS_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  let from = 0;
  for (const part of parts) {
    const at = result.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

/**
 * 核对每条证据：Codex 必须来自有退出码的完成事件，安全解一层 shell 包装后全文匹配；
 * Claude 保留原有空白规范化/包含口径。证据允许去掉字面量 worktree 内 cd 前缀；
 * 且 output 的前 OUTPUT_LINES_CHECKED 个非空行（去首尾空白）都是该次执行结果的子串。
 * 返回不通过的 [{ id, reason: 'command_not_executed' | 'output_not_in_result' }]。
 */
export function unverifiedItems(items, executions, { worktree } = {}) {
  const bad = [];
  for (const item of items) {
    const command = stripWorktreeCd(squashSpace(item.command), worktree);
    const exact = stripWorktreeCd(String(item.command).trim(), worktree);
    const matches = executions.filter((run) => run.provider === 'codex'
      ? run.completed && Number.isInteger(run.exitCode) && matchesShellEvidence(run.command, exact)
      : squashSpace(run.command).includes(command));
    if (matches.length === 0) {
      bad.push({ id: item.id, reason: 'command_not_executed' });
      continue;
    }
    const lines = item.output.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, OUTPUT_LINES_CHECKED);
    if (!matches.some((run) => lines.every((l) => lineInResult(l, run.result)))) bad.push({ id: item.id, reason: 'output_not_in_result' });
  }
  return bad;
}
