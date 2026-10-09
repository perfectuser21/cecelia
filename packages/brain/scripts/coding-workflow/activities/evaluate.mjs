// evaluate 活动（evaluator 真人 QA）：CI 绿后、合并前的门（决策 02d8e749）。
// 在 PR 预览环境（lib/preview.mjs）里，全新 claude 会话只拿 01 需求与 02 的 QA 场景，像真人 QA 一样黑盒验收：
// 按 Q-n 逐条操作 + 探索式测试，写 <sprint_dir>/05-qa-report-r<round>.md。运行期间 03/04（开发自述与自测）藏起，结束放回。
// 程序判：报告格式与 Q-n 覆盖 → 证据须在执行记录里 → 禁单元测试当证据 → 禁碰生产 Brain → PASS/FAIL。
// 产品不合格（qa.verdict FAIL）是正常结果：completed + outputs.qa，交给 runner 的修复环；报告/会话本身不合格才是活动失败。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import { qaScenarios, SPEC_FILE, INTENT_FILE } from '../lib/spec-check.mjs';
import { parseQaReport, judgeQa, unitTestEvidence, productionTouches } from '../lib/qa-report.mjs';
import { bashExecutions, unverifiedItems, sessionCostUsd } from '../lib/transcript.mjs';
import { waitPreview, DEFAULT_PREVIEW_API } from '../lib/preview.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, headSha, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { chainTamperFailure, hideFile, recoverHidden } from '../lib/guards.mjs';

const HIDDEN_FILES = ['03-build.md', '04-evidence.md'];
const TIMEOUT = { envVar: 'CODING_WF_EVALUATE_TIMEOUT_MS', defaultMs: 2400000, reserveMs: 60000 };
const SESSION_FLAGS = ['--output-format', 'stream-json', '--verbose', '--setting-sources', 'user'];
// 允许 Bash 真实操作；不许提交、改历史、切分支、推送、开 PR
const DENIED = [
  'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git rebase:*)', 'Bash(gh:*)',
];

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** 上一轮独立裁判判 QA 没真验到时 runner 传来的裁决（相对 worktree）：必须是 sprint 目录里存在的文件。→ 绝对路径 / '无' / null（非法）。 */
function judgeFeedbackPath(worktree, dir, rel) {
  if (rel === undefined || rel === null || rel === '') return '无';
  const abs = path.resolve(worktree, String(rel));
  return path.dirname(abs) === path.resolve(dir) && fs.existsSync(abs) ? abs : null;
}
const brief = (items) => items.map(({ id, covers, severity, scene, command, output }) => ({
  id, covers, ...(severity ? { severity, scene } : {}), command, output_tail: String(output ?? '').slice(-1000),
}));

/** 会话结束后：HEAD 不许动、sprint 目录外不许写、01/02 不许改。 */
async function guardFailure({ worktree, dir, sprintDir, input, before }) {
  const headAfter = await headSha(worktree);
  if (before.head && headAfter !== before.head) return fail('fatal', 'evaluate_head_moved', { evidence: [{ head_before: before.head, head_after: headAfter }] });
  const tampered = chainTamperFailure(dir, input);
  if (tampered) return tampered;
  const stray = await outOfScopeChanges(worktree, sprintDir, before.changes, 'evaluate');
  if (stray.length > 0) return fail('fatal', 'evaluate_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  return null;
}

/** 报告判分；产品 PASS/FAIL 都返回 completed。 */
function judge({ reportPath, reportFile, qaIds, stdout, worktree, round, env, cost }) {
  const executions = bashExecutions(stdout);
  const prod = productionTouches(executions);
  if (prod.length > 0) return fail('fatal', 'evaluate_touched_production', { evidence: [{ commands: prod }] });
  if (!fs.existsSync(reportPath)) return fail('retryable', 'qa_report_missing');
  const report = parseQaReport(fs.readFileSync(reportPath, 'utf8'));
  const judged = judgeQa(report, qaIds);
  if (judged.reason) return fail('retryable', judged.reason, { evidence: [{ errors: judged.errors, missing: judged.missing }] });
  const items = [...report.tests, ...report.findings];
  const unit = unitTestEvidence(items);
  if (unit.length > 0) return fail('retryable', 'qa_unit_test_evidence', { evidence: [{ items: unit }] });
  const unverified = unverifiedItems(items, executions, { worktree: [worktree, fs.realpathSync(worktree)] });
  if (unverified.length > 0) return fail('retryable', 'qa_evidence_unverified', { evidence: [{ unverified }] });
  const qa = { verdict: judged.verdict, round, env, failed: brief(judged.failed), blocking: brief(judged.blocking), cost_usd: cost };
  log(`[evaluate] 第 ${round} 轮真人 QA ${judged.verdict}：失败场景 ${qa.failed.map((i) => i.id).join(',') || '无'}，阻断发现 ${qa.blocking.map((i) => i.id).join(',') || '无'}`);
  return { status: 'completed', outputs: { qa_report_file: reportFile, qa }, evidence: [`${reportFile}：${judged.verdict}`] };
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;
  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);
  const tamperedBefore = chainTamperFailure(dir, input);
  if (tamperedBefore) return tamperedBefore;
  const specPath = path.join(dir, SPEC_FILE);
  const qaIds = fs.existsSync(specPath) ? qaScenarios(fs.readFileSync(specPath, 'utf8')).map((q) => q.id) : [];
  if (qaIds.length === 0) return fail('fatal', 'qa_missing');
  const judgeFeedback = judgeFeedbackPath(worktree, dir, input.judge_feedback);
  if (!judgeFeedback) return fail('fatal', 'judge_feedback_invalid', { evidence: [{ judge_feedback: input.judge_feedback }] });

  const preview = await waitPreview(input.pr_number, {
    api: process.env.CODING_WF_PREVIEW_API || DEFAULT_PREVIEW_API,
    timeoutMs: posInt(process.env.CODING_WF_PREVIEW_WAIT_MS, 20 * 60 * 1000),
    intervalMs: posInt(process.env.CODING_WF_PREVIEW_INTERVAL_MS, 15000),
    host: process.env.CODING_WF_PREVIEW_HOST || 'localhost',
    // 给了要验的 head：预览部署的必须正是它（审计 P0 #2）
    expectSha: input.head_sha || null,
  });
  if (preview.state === 'stale') return fail('retryable', 'preview_stale', { evidence: [{ pr: input.pr_number, expected: input.head_sha, preview_sha: preview.sha }] });
  if (preview.state !== 'active') return fail('retryable', 'preview_unavailable', { evidence: [{ pr: input.pr_number, preview }] });

  const round = posInt(input.round, 1);
  const reportFile = `05-qa-report-r${round}.md`;
  const reportPath = path.join(dir, reportFile);
  const hiddenPaths = HIDDEN_FILES.map((f) => path.join(dir, f));
  for (const p of hiddenPaths) if (await recoverHidden(worktree, p)) log(`[evaluate] 已放回上次残留的 ${path.basename(p)}`);
  fs.rmSync(reportPath, { force: true });

  const prompt = loadPrompt('evaluate', {
    TASK_ID: input.task_id,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    SPEC_PATH: specPath,
    REPORT_PATH: reportPath,
    SPRINT_DIR: dir,
    SHOTS_DIR: path.join(dir, `qa-r${round}`),
    QA_IDS: qaIds.join(','),
    PREVIEW_URL: preview.url,
    ROUND: String(round),
    JUDGE_FEEDBACK: judgeFeedback,
  });
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', ...SESSION_FLAGS, '--allowedTools', 'Bash', '--disallowedTools', ...DENIED];
  const before = { head: await headSha(worktree), changes: await snapshotChanges(worktree) };

  const state = { hidden: [], claudeRunning: false };
  const restoreAll = () => state.hidden.every((h) => h.restore());
  const onSigterm = () => {
    restoreAll();
    if (!state.claudeRunning) process.exit(2);
  };
  process.on('SIGTERM', onSigterm);
  let result;
  try {
    for (const p of hiddenPaths) state.hidden.push(await hideFile(worktree, p));
    state.claudeRunning = true;
    const run = await runClaude({ args, cwd: worktree, timeoutMs: claudeTimeoutMs(input.budget, TIMEOUT), tag: 'evaluate', isolateRemote: true });
    state.claudeRunning = false;
    result = claudeFailure(run, { streamJson: true }) ?? (await guardFailure({ worktree, dir, sprintDir, input, before }));
    result ??= judge({
      reportPath, reportFile, qaIds, stdout: run.stdout, worktree, round,
      env: { kind: 'preview', url: preview.url, ...(preview.sha ? { sha: preview.sha } : {}) }, cost: Math.round(sessionCostUsd(run.stdout) * 10000) / 10000,
    });
  } finally {
    process.off('SIGTERM', onSigterm);
    if (!restoreAll()) result = fail('fatal', 'hidden_restore_failed', { evidence: [{ hidden: state.hidden.map((h) => h.hiddenPath) }] });
  }
  return result;
});
