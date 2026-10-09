// runner 自己开的 cw PR 分支上的共用操作（CI 修复与 QA 门共用）：检出 PR 分支 worktree、读 sprint 链信息、核对修复提交、推送。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git } from './proc.mjs';
import { writeDevFiles, ensureIgnored, installDeps } from './worktree.mjs';

const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const PUSH_TIMEOUT_MS = 5 * 60 * 1000;
// 修复提交不许碰：sprint 目录（需求与验收记录）、agent 配置
const PROTECTED_RE = /^(sprints\/|\.claude\/|CLAUDE\.md$|AGENTS\.md$)/;
const INTENT_ANCHOR_RE = /^### (I-\d+)(?:[\s:：].*)?$/gm;

const stop = (code) => new Error(code);

/** PR 分支对应的 sprint 目录名（sprints/<stamp>-cw-<id8>）；找不到返回 null。 */
export function sprintDirOf(worktree, branch) {
  const short = branch.slice(-8);
  const sprints = path.join(worktree, 'sprints');
  return fs.existsSync(sprints) ? fs.readdirSync(sprints).find((d) => d.endsWith(`-cw-${short}`)) ?? null : null;
}

/** sprint 的 01-intent.md：{ taskId, intentIds, intentSha256 }；读不到返回 null。 */
export function intentOf(worktree, branch) {
  const dir = sprintDirOf(worktree, branch);
  if (!dir) return null;
  try {
    const text = fs.readFileSync(path.join(worktree, 'sprints', dir, '01-intent.md'), 'utf8');
    return {
      sprintDir: `sprints/${dir}`,
      taskId: /^task_id:\s*(\S+)/m.exec(text)?.[1] ?? null,
      intentIds: [...text.matchAll(INTENT_ANCHOR_RE)].map((m) => m[1]),
      intentSha256: crypto.createHash('sha256').update(text).digest('hex'),
    };
  } catch {
    return null;
  }
}

/** PR 分支 sprint 目录 01-intent.md 里的 task_id；找不到返回 null。 */
export function taskIdOf(worktree, branch) {
  return intentOf(worktree, branch)?.taskId ?? null;
}

/** 建 PR 分支的 worktree（本地分支同名，提交钩子按 .dev-mode.<branch> 认会话）。失败抛 Error(reason_code)。 */
export async function preparePrWorktree(cfg, pr, worktree, signal) {
  const branch = pr.headRefName;
  const fetch = await git(cfg.repo, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) throw stop('git_fetch_failed');
  const add = await git(cfg.repo, ['worktree', 'add', '-B', branch, worktree, `origin/${branch}`]);
  if (add.code !== 0) throw stop('worktree_add_failed');
  writeDevFiles(worktree, branch, { id: taskIdOf(worktree, branch) ?? 'unknown', payload: {} });
  await ensureIgnored(worktree, branch);
  await installDeps(cfg, worktree, signal);
}

/** claude 修复后的核对：工作区干净、有新提交、只追加不改写、不碰受保护路径。通过返回 { commits }，否则抛 Error(reason_code)。 */
export async function checkFixCommits(worktree, before) {
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim()) throw stop('uncommitted');
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head || head === before) throw stop('no_commit');
  if ((await git(worktree, ['merge-base', '--is-ancestor', before, head])).code !== 0) throw stop('history_rewritten');
  const changed = (await git(worktree, ['diff', '--name-only', `${before}..${head}`])).stdout.split('\n').filter(Boolean);
  if (changed.some((f) => PROTECTED_RE.test(f))) throw stop('protected_path');
  const log = await git(worktree, ['rev-list', '--reverse', `${before}..${head}`]);
  return { commits: log.stdout.split('\n').filter(Boolean) };
}

/** 把 worktree 的 HEAD 推到 PR 分支（快进）。失败抛 Error('push_failed')。 */
export async function pushPrHead(worktree, branch) {
  const push = await git(worktree, ['push', 'origin', `HEAD:refs/heads/${branch}`], { timeoutMs: PUSH_TIMEOUT_MS });
  if (push.code !== 0) throw stop('push_failed');
}

export async function headOf(worktree) {
  return (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
}
