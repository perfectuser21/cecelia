// 每轮保留期清理：超期的 cw-* worktree（失败现场，连同本地分支）与超期的每任务回执/日志。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { removeWorktree, pruneWorktrees } from './worktree.mjs';
import { stateDir, repoViews } from './repos.mjs';

const DAY_MS = 24 * 3600 * 1000;
const WORKTREE_RE = /^cw-[0-9a-f]{8}/;
const BRANCH_RE = /^cp-[0-9]{8,10}-cw-[0-9a-f]{8}$/;
const LOG_RE = /\.(json|log)$/;
// QA 门 / CI 修复的状态台账（审计 #34）：不是日志，超期也不删——删了已升级的 PR 会被当新的重新处理
const STATE_RE = /^(?:(qa|cifix)-\d+|pr-sync-pending)\.json$/;

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

async function cleanWorktrees(cfg, cutoff) {
  if (!fs.existsSync(cfg.worktreeBase)) return;
  for (const name of fs.readdirSync(cfg.worktreeBase)) {
    if (!WORKTREE_RE.test(name)) continue;
    const worktree = path.join(cfg.worktreeBase, name);
    // worktree 的 .git 文件在 worktree add 时写下、之后不再改：用它的时间作为现场建立时间
    const created = mtimeMs(path.join(worktree, '.git')) ?? mtimeMs(worktree);
    if (created === null || created > cutoff) continue;
    const head = await git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = head.code === 0 && BRANCH_RE.test(head.stdout.trim()) ? head.stdout.trim() : null;
    await removeWorktree(cfg, worktree, branch);
    if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
  }
}

/** 清一个目录（不递归）里超期的日志/回执；状态台账不删。 */
function cleanLogDir(dir, cutoff) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!LOG_RE.test(name) || STATE_RE.test(name)) continue;
    const file = path.join(dir, name);
    const mtime = mtimeMs(file);
    if (mtime !== null && mtime < cutoff) fs.rmSync(file, { force: true });
  }
}

/** logDir 顶层 + 各已启用仓库的状态命名空间目录（C4：非默认仓的 qa/cifix/commander 状态与会话日志在 <logDir>/<ns>/）。 */
function cleanLogs(cfg, cutoff) {
  const dirs = new Set([cfg.logDir, ...(cfg.repos ?? []).map((rc) => stateDir({ logDir: cfg.logDir, stateNs: rc.stateNs }))]);
  for (const dir of dirs) cleanLogDir(dir, cutoff);
}

/** 尽力而为：任何一步失败只返回，不影响本轮。worktree 按仓库清（各自 worktree 根，用各自 clone remove / prune）。 */
export async function cleanupRetention(cfg, now = Date.now()) {
  for (const view of repoViews(cfg)) {
    await cleanWorktrees(view, now - cfg.failedRetentionDays * DAY_MS);
    await pruneWorktrees(view);
  }
  cleanLogs(cfg, now - cfg.logRetentionDays * DAY_MS);
}
