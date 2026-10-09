// claude `--output-format stream-json --verbose` 对话记录：提取实际执行过的 Bash 命令及其结果，核对 04-evidence 是否有据。
import path from 'node:path';

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
 * claude 自身的错误文本：出错的 `type:"result"` 事件（is_error 或 subtype 非 success）的 subtype 与 result，
 * 以及 `type:"error"` 事件的消息。不含 tool_result 里的业务输出，供鉴权判定使用。
 */
export function claudeOwnErrorText(stdout) {
  const parts = [];
  for (const event of events(stdout)) {
    if (event?.type === 'result' && (event.is_error === true || (event.subtype && event.subtype !== 'success'))) {
      parts.push(String(event.subtype ?? ''), typeof event.result === 'string' ? event.result : '');
    } else if (event?.type === 'error') {
      parts.push(String(event.error?.message ?? event.message ?? ''));
    }
  }
  return parts.filter(Boolean).join('\n');
}

/** 一次 claude 会话的花费（stream-json 最后一个 result 事件的 total_cost_usd）；拿不到为 0。 */
export function sessionCostUsd(stdout) {
  let cost = 0;
  for (const event of events(stdout)) {
    if (event?.type === 'result' && typeof event.total_cost_usd === 'number') cost = event.total_cost_usd;
  }
  return cost;
}

/** stdout（每行一个 JSON 事件，非 JSON 行忽略）→ 按出现顺序的 [{ command, result }]；没有结果的命令 result 为 ''。 */
export function bashExecutions(stdout) {
  const runs = [];
  const byId = new Map();
  for (const event of events(stdout)) {
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
  return insideWorktree(dir, roots) ? command.slice(m[0].length) : command;
}

/**
 * 核对每条证据：command（规范化空白、去掉 worktree 内 cd 前缀后）必须被某次实际执行的命令包含；
 * 且 output 的前 OUTPUT_LINES_CHECKED 个非空行（去首尾空白）都是该次执行结果的子串。
 * 返回不通过的 [{ id, reason: 'command_not_executed' | 'output_not_in_result' }]。
 */
export function unverifiedItems(items, executions, { worktree } = {}) {
  const bad = [];
  for (const item of items) {
    const command = stripWorktreeCd(squashSpace(item.command), worktree);
    const matches = executions.filter((run) => squashSpace(run.command).includes(command));
    if (matches.length === 0) {
      bad.push({ id: item.id, reason: 'command_not_executed' });
      continue;
    }
    const lines = item.output.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, OUTPUT_LINES_CHECKED);
    if (!matches.some((run) => lines.every((l) => run.result.includes(l)))) bad.push({ id: item.id, reason: 'output_not_in_result' });
  }
  return bad;
}
