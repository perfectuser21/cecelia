/** 会话摘要只在主力 worker 的 OpenClaw Codex 上生成，Brain 不持推理凭据。 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { sshWithStdin } from './lib/ssh-exec.js';
import { resolvePrimaryWorkerId, sshTargetFor } from './machine-registry.js';
function summaryText(stdout) {
  // CLI 可能在完整 JSON 前打印启动日志；不从破损 JSON 内提取正文。
  let receipt;
  const start = stdout.search(/(?:^|\n)\s*\{/);
  if (start >= 0) {
    try { receipt = JSON.parse(stdout.slice(start).trim()); } catch { /* 破损包装拒绝消费 */ }
  }
  const result = receipt?.result ?? receipt;
  if (!receipt || [receipt, result, result?.meta].some(value => value &&
    (value.error || value.aborted || (value.status && !['ok', 'success', 'completed'].includes(value.status))))) {
    throw new Error('summary_reply_missing');
  }
  const text = result.finalAssistantVisibleText ?? result.meta?.finalAssistantVisibleText ?? result.payloads?.map(item => item.text || '').join('\n');
  if (typeof text !== 'string' || !text.trim()) throw new Error('summary_reply_missing');
  return text;
}

export async function callConversationSummary(_agentId, prompt) {
  const sessionId = `summary-${randomUUID()}`;
  // 正文只经 stdin → 600 文件；不进 ssh 命令行，不被 shell 插值。
  const command = [
    'set -e',
    'umask 077',
    'summary_prompt=$(mktemp)',
    'trap \'rm -f "$summary_prompt"\' EXIT',
    'cat > "$summary_prompt"',
    `/opt/homebrew/bin/openclaw agent --agent conversation-summarizer --session-id ${sessionId} --thinking low --timeout 90 --json --message-file "$summary_prompt"`,
  ].join('; ');
  const stdout = await sshWithStdin(spawn,
    [...SSH_BASE_ARGS, sshTargetFor(resolvePrimaryWorkerId()), command], prompt, 105_000);
  const text = summaryText(stdout);
  return { text, provider: 'openclaw', session_id: sessionId };
}
