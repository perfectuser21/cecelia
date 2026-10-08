// 任务 worktree：从专用 clone 的 origin/main 建分支 worktree，写 /dev 会话文件，根目录 npm ci；成功后删除。
import fs from 'node:fs';
import path from 'node:path';
import { run, git } from './proc.mjs';

const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const NPM_CI_TIMEOUT_MS = 20 * 60 * 1000;
const IGNORE_PATTERNS = ['.dev-mode*', '.dev-lock*'];

const fail = (code) => new Error(code);

/** 本机全局 pre-commit 钩子要求 .dev-mode.<branch>；.dev-lock.<branch> 供会话/收割工具识别归属。 */
function writeDevFiles(worktree, branch, task) {
  const now = new Date().toISOString();
  const gpAnchor = typeof task.payload?.gp_anchor === 'string' && task.payload.gp_anchor
    ? task.payload.gp_anchor
    : 'none(infra)';
  fs.writeFileSync(path.join(worktree, `.dev-mode.${branch}`), [
    'dev',
    `branch: ${branch}`,
    'session_id: coding-workflow-runner',
    `started: ${now}`,
    `task_id: ${task.id}`,
    `gp_anchor: ${gpAnchor}`,
    'step_1_spec: done',
    'harness_mode: false',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(worktree, `.dev-lock.${branch}`), `${JSON.stringify({
    task_id: task.id,
    repo: 'cecelia',
    branch,
    owner_session: 'coding-workflow-runner',
    session_id: `coding-workflow-runner-${task.id}`,
    worktree_path: worktree,
    created_at: now,
  }, null, 2)}\n`);
}

/** 会话文件不能被提交：仓库 .gitignore 没忽略时补进 clone 的 info/exclude（所有 worktree 共享）。 */
async function ensureIgnored(worktree, branch) {
  const probe = await git(worktree, ['check-ignore', '-q', `.dev-mode.${branch}`]);
  if (probe.code === 0) return;
  const common = await git(worktree, ['rev-parse', '--git-common-dir']);
  if (common.code !== 0) throw fail('git_exclude_failed');
  const infoDir = path.join(path.resolve(worktree, common.stdout.trim()), 'info');
  fs.mkdirSync(infoDir, { recursive: true });
  fs.appendFileSync(path.join(infoDir, 'exclude'), `\n${IGNORE_PATTERNS.join('\n')}\n`);
}

/**
 * 建 worktree。过程中把已建好的路径/分支写进 ctx（失败时调用方据此保留现场、写日志）。
 * 失败抛 Error(reason_code)：git_fetch_failed / worktree_add_failed / git_exclude_failed / npm_ci_failed。
 */
export async function prepareWorktree(cfg, task, names, ctx, signal) {
  const fetch = await git(cfg.repo, ['fetch', 'origin', 'main'], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) throw fail('git_fetch_failed');

  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  let worktree = path.join(cfg.worktreeBase, `cw-${names.short}`);
  // 同一任务上次失败保留的现场不覆盖
  if (fs.existsSync(worktree)) worktree = `${worktree}-${names.stamp}`;
  const add = await git(cfg.repo, ['worktree', 'add', '-b', names.branch, worktree, 'origin/main']);
  if (add.code !== 0) throw fail('worktree_add_failed');
  ctx.worktree = worktree;
  ctx.branch = names.branch;

  writeDevFiles(worktree, names.branch, task);
  await ensureIgnored(worktree, names.branch);

  if (!cfg.skipNpmCi) {
    if (signal?.aborted) throw fail('runner_terminated');
    // npm workspaces：只能在 worktree 根目录跑，单包目录里跑会清掉其他包的依赖
    const ci = await run('npm', ['ci', '--legacy-peer-deps', '--ignore-scripts'], { cwd: worktree, timeoutMs: NPM_CI_TIMEOUT_MS, signal });
    if (signal?.aborted) throw fail('runner_terminated');
    if (ci.code !== 0) throw fail('npm_ci_failed');
  }
  return worktree;
}

/** 删除 worktree 与本地分支（分支已推到远端）；返回是否删除成功。 */
export async function removeWorktree(cfg, worktree, branch) {
  const removed = await git(cfg.repo, ['worktree', 'remove', '--force', worktree]);
  if (branch) await git(cfg.repo, ['branch', '-D', branch]);
  return removed.code === 0;
}

/** 清理 clone 里已不存在的 worktree 登记（尽力而为）。 */
export async function pruneWorktrees(cfg) {
  if (!fs.existsSync(cfg.repo)) return;
  await git(cfg.repo, ['worktree', 'prune']);
}
