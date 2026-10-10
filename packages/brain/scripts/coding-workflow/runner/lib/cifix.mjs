// CI 红自动修复：对 findTarget 找到的 cw PR，在 PR 分支 worktree 里让 claude 按失败日志修复并提交，
// 程序核对（有新提交、工作区干净、只追加不改写、不碰 sprints/ 与 agent 配置）后由 runner 推送。
// 每次尝试都记进 <logDir>/cifix-<pr>.json 并回写 Brain 任务 result.ci_fix；worktree 用完即删。
import fs from 'node:fs';
import path from 'node:path';
import { git, run } from './proc.mjs';
import { removeWorktree } from './worktree.mjs';
import { findTarget, failureLogs, readState, statePath } from './cifix-scan.mjs';
import { taskIdOf, remoteTaskId, preparePrWorktree, checkFixCommits, pushPrHead } from './pr-branch.mjs';
import { runClaude, loadPrompt } from '../../lib/claude.mjs';
import { revokeQaPass } from './qa-gate.mjs';
import { gateSpan, postSpans } from './spans.mjs';

const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];
const GH_TIMEOUT_MS = 2 * 60 * 1000;

const stop = (code) => new Error(code);

async function attempt(ctx, target, worktree, signal) {
  const { cfg } = ctx;
  const { pr } = target;
  await preparePrWorktree(cfg, pr, worktree, signal);
  const before = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const logs = await failureLogs(cfg, pr.number);
  const prompt = loadPrompt('ci-fix', {
    BRANCH: pr.headRefName,
    PR_URL: pr.url ?? '',
    FAILED_CHECKS: (logs.names.length > 0 ? logs.names : target.failedRequired).join('、'),
    CI_LOGS: logs.text || '（未取到失败 job 日志，请先本地运行相关测试定位）',
  });
  ctx.log(`CI 修复 PR #${pr.number}（${pr.headRefName}）：失败检查 ${target.failedRequired.join('、')}`);
  const run = await runClaude({
    args: ['-p', prompt, '--permission-mode', 'acceptEdits', ...CLAUDE_TOOLS],
    cwd: worktree,
    timeoutMs: cfg.ciFixTimeoutMs,
    tag: 'ci-fix',
    isolateRemote: true,
  });
  fs.mkdirSync(cfg.logDir, { recursive: true });
  fs.writeFileSync(path.join(cfg.logDir, `cifix-${pr.number}-${Date.now()}.log`), run.output ?? '');
  // 会话一结束就记花费（审计 #35），后面抛错的路径也不漏
  if (typeof run.cost_usd === 'number' && run.cost_usd > 0) {
    const state = readState(cfg, pr.number);
    state.cost_usd = Math.round(((state.cost_usd ?? 0) + run.cost_usd) * 10000) / 10000;
    saveState(cfg, pr.number, state);
  }
  if (run.terminated) throw stop('runner_terminated');
  if (run.timedOut) throw stop('claude_timeout');
  if (run.code !== 0) throw stop('claude_failed');
  const { commits } = await checkFixCommits(worktree, before);
  const files = (await git(worktree, ['diff', '--name-only', `${before}..HEAD`])).stdout.split('\n').filter(Boolean);
  await pushPrHead(worktree, pr.headRefName);
  const revoked = await revokeQaPass(ctx, pr, files, 'ci_fix_changed_code');
  return { result: 'pushed', commits, ...(revoked ? { qa_revoked: true } : {}) };
}

/** 记一次尝试：本地状态文件 + Brain 任务 result.ci_fix（拿不到 task_id 只记本地）。 */
async function record(ctx, pr, taskId, entry) {
  const state = readState(ctx.cfg, pr.number);
  state.attempts.push(entry);
  fs.mkdirSync(ctx.cfg.logDir, { recursive: true });
  fs.writeFileSync(statePath(ctx.cfg, pr.number), `${JSON.stringify(state, null, 2)}\n`);
  if (!taskId) return;
  const r = await ctx.brain.patch(taskId, { result: { ci_fix: { attempts: state.attempts } } });
  if (!r.ok) ctx.log(`CI 修复回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}）`);
}

function saveState(cfg, prNumber, state) {
  fs.mkdirSync(cfg.logDir, { recursive: true });
  fs.writeFileSync(statePath(cfg, prNumber), `${JSON.stringify(state, null, 2)}\n`);
}

/** 修不动：升级给 coding commander（P1 日志 + Brain result.escalations），之后不再处理这个 PR。 */
async function escalateCi(ctx, pr, state, reason) {
  state.escalated = { type: 'ci_fix_exhausted', reason, pr: pr.number, head: pr.headRefOid, at: new Date().toISOString() };
  saveState(ctx.cfg, pr.number, state);
  ctx.log(`[coding-ci][P1] PR #${pr.number} CI 修不动，升级给 coding commander：${reason}`);
  const taskId = await remoteTaskId(ctx.cfg, pr.headRefName);
  if (!taskId) return;
  const r = await ctx.brain.patch(taskId, { result: { ci_fix: { attempts: state.attempts }, escalations: [state.escalated] } });
  if (!r.ok) ctx.log(`CI 修复升级回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}）`);
}

/** 落后 main：程序 gh pr update-branch（不派 claude、不占修复次数）。 */
async function updateBranch(ctx, pr, state) {
  const r = await run(ctx.cfg.ghBin, ['pr', 'update-branch', String(pr.number)], { cwd: ctx.cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  state.update_branch = [...(state.update_branch ?? []), { head: pr.headRefOid, at: new Date().toISOString(), ok: r.code === 0 }];
  saveState(ctx.cfg, pr.number, state);
  ctx.log(`CI 修复 PR #${pr.number}：落后 main，update-branch ${r.code === 0 ? '成功' : '失败'}`);
}

/** 本 head 修过但没改（claude 判定失败与本 PR 无关）：重跑失败 job 一次再看。 */
async function rerunFailed(ctx, pr, state, checks) {
  const runIds = [...new Set(checks.map((c) => c.runId).filter(Boolean))];
  for (const id of runIds) await run(ctx.cfg.ghBin, ['run', 'rerun', id, '--failed'], { cwd: ctx.cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  state.reruns = { ...state.reruns, [pr.headRefOid]: new Date().toISOString() };
  saveState(ctx.cfg, pr.number, state);
  ctx.log(`CI 修复 PR #${pr.number}：本 head 修过无改动，重跑失败 job（${runIds.join('、') || '无'}）`);
}

/** 本轮处理至多一个 PR（修复/重跑/update-branch/升级都算处理）；处理了返回 true，没有目标返回 false。不抛错。 */
export async function runCiFix(ctx, signal) {
  const { cfg } = ctx;
  let target;
  try {
    target = await findTarget(cfg, ctx.log);
    if (target && target.action !== 'fix') {
      const state = readState(cfg, target.pr.number);
      if (target.action === 'escalate') await escalateCi(ctx, target.pr, state, target.reason);
      if (target.action === 'update_branch') await updateBranch(ctx, target.pr, state);
      if (target.action === 'rerun') await rerunFailed(ctx, target.pr, state, target.checks);
      return true;
    }
  } catch (error) {
    ctx.log(`CI 修复：找目标失败 ${error?.message || error}`);
    return false;
  }
  if (!target) return false;

  const { pr } = target;
  const worktree = path.join(cfg.worktreeBase, `cifix-${pr.number}-${readState(cfg, pr.number).attempts.length + 1}`);
  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  if (fs.existsSync(worktree)) await removeWorktree(cfg, worktree, null);
  fs.rmSync(worktree, { recursive: true, force: true });

  const startedAt = Date.now();
  const attemptNo = readState(cfg, pr.number).attempts.length + 1;
  const entry = { pr: pr.number, head: pr.headRefOid, at: new Date().toISOString(), failed_checks: target.failedRequired };
  try {
    Object.assign(entry, await attempt(ctx, target, worktree, signal));
  } catch (error) {
    entry.result = error?.message || 'ci_fix_error';
  }
  const taskId = fs.existsSync(worktree) ? taskIdOf(worktree, pr.headRefName) : null;
  ctx.log(`CI 修复 PR #${pr.number} 结果：${entry.result}`);
  await record(ctx, pr, taskId, entry);
  // 执行记录（决策 b34e346a）：每次修复尝试一条
  if (taskId) {
    await postSpans(ctx, [gateSpan({
      taskId, key: 'ci_fix', startedAt, endedAt: Date.now(), ok: entry.result === 'pushed',
      occurrence: `${pr.number}:${attemptNo}`, evidence: { result: entry.result, failed_checks: target.failedRequired },
    })]);
  }
  await removeWorktree(cfg, worktree, pr.headRefName);
  fs.rmSync(worktree, { recursive: true, force: true });
  return true;
}
