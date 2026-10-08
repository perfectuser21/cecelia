// CI 红自动修复：对 findTarget 找到的 cw PR，在 PR 分支 worktree 里让 claude 按失败日志修复并提交，
// 程序核对（有新提交、工作区干净、只追加不改写、不碰 sprints/ 与 agent 配置）后由 runner 推送。
// 每次尝试都记进 <logDir>/cifix-<pr>.json 并回写 Brain 任务 result.ci_fix；worktree 用完即删。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { writeDevFiles, ensureIgnored, installDeps, removeWorktree } from './worktree.mjs';
import { findTarget, failureLogs, readState, statePath } from './cifix-scan.mjs';
import { runClaude, loadPrompt } from '../../lib/claude.mjs';

const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const PUSH_TIMEOUT_MS = 5 * 60 * 1000;
const PROTECTED_RE = /^(sprints\/|\.claude\/|CLAUDE\.md$|AGENTS\.md$)/;
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];

const stop = (code) => new Error(code);

/** PR 分支 sprint 目录 01-intent.md 里的 task_id；找不到返回 null。 */
function taskIdOf(worktree, branch) {
  const short = branch.slice(-8);
  const sprints = path.join(worktree, 'sprints');
  const dir = fs.existsSync(sprints) ? fs.readdirSync(sprints).find((d) => d.endsWith(`-cw-${short}`)) : null;
  if (!dir) return null;
  try {
    return /^task_id:\s*(\S+)/m.exec(fs.readFileSync(path.join(sprints, dir, '01-intent.md'), 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 建 PR 分支的修复 worktree（本地分支同名，提交钩子按 .dev-mode.<branch> 认会话）。 */
async function prepare(cfg, pr, worktree, signal) {
  const branch = pr.headRefName;
  const fetch = await git(cfg.repo, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) throw stop('git_fetch_failed');
  const add = await git(cfg.repo, ['worktree', 'add', '-B', branch, worktree, `origin/${branch}`]);
  if (add.code !== 0) throw stop('worktree_add_failed');
  writeDevFiles(worktree, branch, { id: taskIdOf(worktree, branch) ?? 'unknown', payload: {} });
  await ensureIgnored(worktree, branch);
  await installDeps(cfg, worktree, signal);
}

/** claude 跑完后的核对；通过返回 { commits }，否则抛 Error(reason_code)。 */
async function check(worktree, before) {
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim()) throw stop('uncommitted');
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head || head === before) throw stop('no_commit');
  if ((await git(worktree, ['merge-base', '--is-ancestor', before, head])).code !== 0) throw stop('history_rewritten');
  const changed = (await git(worktree, ['diff', '--name-only', `${before}..${head}`])).stdout.split('\n').filter(Boolean);
  if (changed.some((f) => PROTECTED_RE.test(f))) throw stop('protected_path');
  const log = await git(worktree, ['rev-list', '--reverse', `${before}..${head}`]);
  return { commits: log.stdout.split('\n').filter(Boolean) };
}

async function attempt(ctx, target, worktree, signal) {
  const { cfg } = ctx;
  const { pr } = target;
  await prepare(cfg, pr, worktree, signal);
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
  if (run.terminated) throw stop('runner_terminated');
  if (run.timedOut) throw stop('claude_timeout');
  if (run.code !== 0) throw stop('claude_failed');
  const { commits } = await check(worktree, before);
  const push = await git(worktree, ['push', 'origin', `HEAD:refs/heads/${pr.headRefName}`], { timeoutMs: PUSH_TIMEOUT_MS });
  if (push.code !== 0) throw stop('push_failed');
  return { result: 'pushed', commits };
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

/** 本轮修至多一个 PR；修了（无论成败）返回 true，没有目标返回 false。不抛错。 */
export async function runCiFix(ctx, signal) {
  const { cfg } = ctx;
  let target;
  try {
    target = await findTarget(cfg, ctx.log);
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

  const entry = { pr: pr.number, head: pr.headRefOid, at: new Date().toISOString(), failed_checks: target.failedRequired };
  try {
    Object.assign(entry, await attempt(ctx, target, worktree, signal));
  } catch (error) {
    entry.result = error?.message || 'ci_fix_error';
  }
  const taskId = fs.existsSync(worktree) ? taskIdOf(worktree, pr.headRefName) : null;
  ctx.log(`CI 修复 PR #${pr.number} 结果：${entry.result}`);
  await record(ctx, pr, taskId, entry);
  await removeWorktree(cfg, worktree, pr.headRefName);
  fs.rmSync(worktree, { recursive: true, force: true });
  return true;
}
