// 独立裁判只消费控制器提供的冻结输入；空目录、无工具、只读、无网络、无历史会话。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runClaude, claudeFailure } from './claude.mjs';

export async function callCodexJudge({ system, user }, { model, codexHome, codexBin, transcriptPath, timeoutMs = 600000 }) {
  if (!codexHome || !model) throw new Error('judge_codex_config_missing');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-wf-judge-'));
  const lastMessage = path.join(cwd, 'last-message.txt');
  try {
    const run = await runClaude({
      provider: 'codex', cwd, timeoutMs, tag: 'judge', transcriptPath, isolateRemote: true,
      nativeOptions: { access: 'judge', outputLastMessage: lastMessage },
      codexEnv: { CODING_WF_CODEX_HOME: codexHome, CODING_WF_CODEX_MODEL: model, CODING_WF_CODEX_BIN: codexBin || 'codex' },
      args: ['-p', `${system}\n\n${user}`, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'],
    });
    const rows = run.stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const failed = rows.some((r) => r.type === 'turn.failed' || r.type === 'error');
    const failure = claudeFailure({ ...run, code: failed && run.code === 0 ? 1 : run.code }, { streamJson: true });
    if (failure) throw new Error(failure.reason_code === 'codex_auth' ? 'judge_codex_auth' : failure.reason_code === 'codex_configuration' ? 'judge_codex_configuration' : run.timedOut ? 'judge_codex_timeout' : 'judge_codex_failed');
    if (rows.some((r) => /^item\./.test(r.type ?? '') && !['agent_message', 'reasoning'].includes(r.item?.type))) throw new Error('judge_codex_tool_used');
    const completed = rows.filter((r) => r.type === 'turn.completed');
    if (completed.length !== 1) throw new Error('judge_codex_incomplete');
    // 工具输出、推理及中间 commentary 不能冒充裁判最终答复。
    const messages = rows.filter((r) => r.type === 'item.completed' && r.item?.type === 'agent_message');
    const content = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, 'utf8') : '';
    if (typeof content !== 'string' || !content.trim()) throw new Error('judge_empty');
    if (!messages.some((r) => r.item.text?.trim() === content.trim())) throw new Error('judge_codex_output_unverified');
    const input_sha256 = createHash('sha256').update(JSON.stringify({ system, user })).digest('hex');
    return { content, usage: completed[0].usage ?? null, provider: 'codex', model, cost_usd: null, transcriptPath, input_sha256 };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
