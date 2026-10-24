// 任务 worktree：从登记的 base_sha（旧任务缺省 origin/main）建独立分支，写 /dev 会话文件并安装依赖。
import fs from 'node:fs';
import path from 'node:path';
import { run, git } from './proc.mjs';

const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const NPM_CI_TIMEOUT_MS = 20 * 60 * 1000;
const IGNORE_PATTERNS = ['.dev-mode*', '.dev-lock*'];

const fail = (code) => new Error(code);

/** 本机全局 pre-commit 钩子要求 .dev-mode.<branch>；.dev-lock.<branch> 供会话/收割工具识别归属。 */
export function writeDevFiles(worktree, branch, task, repoKey = 'cecelia') {
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
    repo: repoKey,
    branch,
    owner_session: 'coding-workflow-runner',
    session_id: `coding-workflow-runner-${task.id}`,
    worktree_path: worktree,
    created_at: now,
  }, null, 2)}\n`);
}

/** 会话文件不能被提交：仓库 .gitignore 没忽略时补进 clone 的 info/exclude（所有 worktree 共享）。 */
export async function ensureIgnored(worktree, branch) {
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
  const hasBase = Object.hasOwn(task.payload ?? {}, 'base_sha');
  const base = hasBase ? task.payload.base_sha : 'origin/main';
  if (hasBase && (typeof base !== 'string' || !/^[a-f0-9]{40}$/.test(base))) {
    throw fail('task_base_sha_invalid');
  }
  const fetch = await git(cfg.repo, ['fetch', 'origin', 'main'], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) throw fail('git_fetch_failed');
  if (hasBase) {
    const commit = await git(cfg.repo, ['cat-file', '-t', base]);
    if (commit.code !== 0 || commit.stdout.trim() !== 'commit') throw fail('task_base_commit_missing');
  }

  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  let worktree = path.join(cfg.worktreeBase, `cw-${names.short}`);
  // 同一任务上次失败保留的现场不覆盖
  if (fs.existsSync(worktree)) worktree = `${worktree}-${names.stamp}`;
  const add = await git(cfg.repo, ['worktree', 'add', '-b', names.branch, worktree, base]);
  if (add.code !== 0) throw fail('worktree_add_failed');
  ctx.worktree = worktree;
  ctx.branch = names.branch;

  writeDevFiles(worktree, names.branch, task, cfg.repoKey ?? 'cecelia');
  await ensureIgnored(worktree, names.branch);
  await installDeps(cfg, worktree, signal);
  return worktree;
}

const DEFAULT_INSTALL = ['npm', 'ci', '--legacy-peer-deps', '--ignore-scripts'];

/** 准备依赖及锁定技能，与 CI 的 Restore pinned skill sources 保持一致。 */
export async function installDeps(cfg, worktree, signal) {
  if (signal?.aborted) throw fail('runner_terminated');
  if (!cfg.skipNpmCi) {
    // npm workspaces：只能在 worktree 根目录跑，单包目录里跑会清掉其他包的依赖
    const [bin, ...args] = Array.isArray(cfg.install) && cfg.install.length > 0 ? cfg.install : DEFAULT_INSTALL;
    const ci = await run(bin, args, { cwd: worktree, timeoutMs: NPM_CI_TIMEOUT_MS, signal });
    if (signal?.aborted) throw fail('runner_terminated');
    if (ci.code !== 0) throw fail('npm_ci_failed');
  }
  // 技能正文是固定来源依赖；缺失/校验失败不能交给模型改 registry 来绕过。
  if (fs.existsSync(path.join(worktree, '.skills-source.json'))) {
    const skills = await run('bash', ['scripts/ensure-skills-source.sh', worktree], {
      cwd: worktree, timeoutMs: FETCH_TIMEOUT_MS, signal,
    });
    if (signal?.aborted) throw fail('runner_terminated');
    if (skills.code !== 0) throw fail('skill_source_restore_failed');
  }
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
