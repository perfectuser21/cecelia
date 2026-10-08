// verify 活动：全新 claude 会话只拿 01-intent.md 与 worktree，对每条 I-n 真实运行命令取证，写 <sprint_dir>/04-evidence.md。
// 判分由程序做：04 的格式与覆盖（lib/evidence）、每条证据须在 stream-json 执行记录里有据（lib/transcript）、再看 verdict。
// 运行期间 03-build.md 暂移出 sprint 目录（不受干活方自述影响），结束后无论成败都放回。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import { parseEvidence, judgeEvidence } from '../lib/evidence.mjs';
import { bashExecutions, unverifiedItems } from '../lib/transcript.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, headSha, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { chainTamperFailure, remoteChangeFailure, remoteSnapshot, hideFile, recoverHidden } from '../lib/guards.mjs';

const INTENT_FILE = '01-intent.md';
const BUILD_FILE = '03-build.md';
const EVIDENCE_FILE = '04-evidence.md';
// 默认 = budget 1200s - 90s：超时由本活动先报 claude_timeout，并给 claude 退出后的检查阶段（含最长 60s 的 ls-remote）留余量
const TIMEOUT = { envVar: 'CODING_WF_VERIFY_TIMEOUT_MS', defaultMs: 1110000, reserveMs: 75000 };
// stream-json 对话记录用于核对证据；只读用户级设置，build 提交进仓库的项目级 .claude 配置不影响本会话
const SESSION_FLAGS = ['--output-format', 'stream-json', '--verbose', '--setting-sources', 'user'];
// 允许 Bash 真跑命令取证；不许提交、改历史、切分支、推送、开 PR
const DENIED = [
  'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git rebase:*)', 'Bash(gh:*)',
];

/** 验收不通过：outputs.verification 供 report 回写 Brain（执行器对 failed 结果同样合并 outputs 进上下文）。 */
function rejected(reason, evidence, { failed = [], ...extra } = {}) {
  return fail('fatal', reason, {
    outputs: { verification: { status: 'failed', reason_code: reason, failed, ...extra } },
    evidence: [evidence],
  });
}

/** 运行后检查：HEAD、远端、md 链、sprint 目录外改动。有问题返回 fail，否则 null。 */
async function guardFailure({ worktree, dir, sprintDir, input, before }) {
  const headAfter = await headSha(worktree);
  if (before.head && headAfter !== before.head) {
    return fail('fatal', 'verify_head_moved', { evidence: [{ head_before: before.head, head_after: headAfter }] });
  }
  const guard = (await remoteChangeFailure(worktree, before.remote)) ?? chainTamperFailure(dir, input);
  if (guard) return guard;
  const stray = await outOfScopeChanges(worktree, sprintDir, before.changes, 'verify');
  if (stray.length > 0) return fail('fatal', 'verify_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  return null;
}

/** 判分：格式/覆盖 → 执行记录核对 → verdict。 */
function judge(text, intentIds, transcript, worktree) {
  const parsed = parseEvidence(text);
  const judged = judgeEvidence(parsed, intentIds);
  if (judged.reason === 'evidence_invalid') return rejected(judged.reason, { errors: judged.errors }, { errors: judged.errors });
  if (judged.reason === 'evidence_incomplete') return rejected(judged.reason, { missing: judged.missing }, { missing: judged.missing });
  // worktree 的原路径与真实路径都算（macOS 上 /var 与 /private/var 指向同一处）
  const roots = [worktree, fs.realpathSync(worktree)];
  const unverified = unverifiedItems(parsed.items, bashExecutions(transcript), { worktree: roots });
  if (unverified.length > 0) return rejected('evidence_unverified', { unverified }, { unverified });
  if (judged.reason === 'verification_failed') {
    const failed = judged.failed.map(({ id, covers, command, output }) => ({ id, covers, command, output_tail: output }));
    return rejected(judged.reason, { failed: judged.failed, verdicts: judged.summary }, { failed });
  }
  return {
    status: 'completed',
    outputs: { evidence_file: EVIDENCE_FILE, verified_ids: judged.verifiedIds },
    evidence: [`${EVIDENCE_FILE}：${judged.verifiedIds.length} 条验收全部 PASS`],
  };
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;
  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);
  const tamperedBefore = chainTamperFailure(dir, input);
  if (tamperedBefore) return tamperedBefore;

  const evidencePath = path.join(dir, EVIDENCE_FILE);
  const buildPath = path.join(dir, BUILD_FILE);
  // 上次运行被硬杀时 03 可能还留在 git 目录下：先放回
  if (await recoverHidden(worktree, buildPath)) log('[verify] 已放回上次残留的 03-build.md');
  const prompt = loadPrompt('verify', {
    TASK_ID: input.task_id,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    EVIDENCE_PATH: evidencePath,
    INTENT_IDS: intentIds.join(','),
    SPRINT_DIR: dir,
  });

  // 旧产物会被当成新产物，先删
  fs.rmSync(evidencePath, { force: true });
  const before = { head: await headSha(worktree), remote: await remoteSnapshot(worktree), changes: await snapshotChanges(worktree) };
  // 运行前就查不到远端，事后无从比对：不启动 claude
  if (before.remote === null) return fail('retryable', 'remote_check_failed', { evidence: [{ remote_before: null }] });
  const args = [
    '-p', prompt, '--permission-mode', 'acceptEdits', ...SESSION_FLAGS,
    // 权限规则里 `//` 开头才是绝对路径（单 `/` 相对项目根）
    '--allowedTools', 'Bash', '--disallowedTools', ...DENIED, `Read(/${buildPath})`,
  ];

  // 从隐藏 03 之前到放回之后都接管 SIGTERM：收到即放回。claude 运行中由 runClaude 收割进程组后正常返回；
  // claude 退出后的检查阶段（可能卡在 ls-remote）没有别的处理者，放回后直接退出
  const state = { hidden: null, claudeRunning: false };
  const onSigterm = () => {
    state.hidden?.restore();
    if (!state.claudeRunning) process.exit(2);
  };
  process.on('SIGTERM', onSigterm);
  let result;
  try {
    state.hidden = await hideFile(worktree, buildPath);
    const timeoutMs = claudeTimeoutMs(input.budget, TIMEOUT);
    state.claudeRunning = true;
    const run = await runClaude({ args, cwd: worktree, timeoutMs, tag: 'verify', isolateRemote: true });
    state.claudeRunning = false;
    result = claudeFailure(run, { streamJson: true }) ?? (await guardFailure({ worktree, dir, sprintDir, input, before }));
    if (!result && !fs.existsSync(evidencePath)) result = fail('fatal', 'evidence_missing');
    result ??= judge(fs.readFileSync(evidencePath, 'utf8'), intentIds, run.stdout, worktree);
  } finally {
    process.off('SIGTERM', onSigterm);
    if (state.hidden && !state.hidden.restore()) {
      result = fail('fatal', 'build_report_restore_failed', { evidence: [{ hidden_path: state.hidden.hiddenPath }] });
    }
  }
  return result;
});
