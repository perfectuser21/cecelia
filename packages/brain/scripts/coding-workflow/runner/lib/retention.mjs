// 每轮保留期清理：超期的 cw-* worktree（失败现场，连同本地分支）与超期的每任务回执/日志。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { removeWorktree, pruneWorktrees } from './worktree.mjs';

const DAY_MS = 24 * 3600 * 1000;
const WORKTREE_RE = /^cw-[0-9a-f]{8}/;
const BRANCH_RE = /^cp-[0-9]{8,10}-cw-[0-9a-f]{8}$/;
const LOG_RE = /\.(json|log)$/;

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

function cleanLogs(cfg, cutoff) {
  if (!fs.existsSync(cfg.logDir)) return;
  for (const name of fs.readdirSync(cfg.logDir)) {
    if (!LOG_RE.test(name)) continue;
    const file = path.join(cfg.logDir, name);
    const mtime = mtimeMs(file);
    if (mtime !== null && mtime < cutoff) fs.rmSync(file, { force: true });
  }
}

/** 尽力而为：任何一步失败只返回，不影响本轮。 */
export async function cleanupRetention(cfg, now = Date.now()) {
  await cleanWorktrees(cfg, now - cfg.failedRetentionDays * DAY_MS);
  await pruneWorktrees(cfg);
  cleanLogs(cfg, now - cfg.logRetentionDays * DAY_MS);
}
