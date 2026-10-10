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

/** 不检出 worktree，直接从远端 PR 分支读 sprint 01-intent.md 的 task_id；拿不到返回 null。 */
export async function remoteTaskId(cfg, branch) {
  const fetch = await git(cfg.repo, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) return null;
  const ls = await git(cfg.repo, ['ls-tree', '--name-only', `origin/${branch}`, 'sprints/']);
  const dir = ls.stdout.split('\n').find((d) => d.endsWith(`-cw-${branch.slice(-8)}`));
  if (!dir) return null;
  const show = await git(cfg.repo, ['show', `origin/${branch}:${dir}/01-intent.md`]);
  return show.code === 0 ? /^task_id:\s*(\S+)/m.exec(show.stdout)?.[1] ?? null : null;
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

// 修复环节不得靠削弱测试变绿（审计 #31，对应旧 generator「CONTRACT IS LAW」）
const TEST_FILE_RE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|only|todo)\s*\(|\bx(?:it|describe)\s*\(/;
const ASSERT_RE = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(/g;

const assertCount = (text) => (text.match(ASSERT_RE) ?? []).length;

/**
 * before..head 是否削弱了 main 上已有的测试（决策 b057089b）：删除、加 skip/only/todo、断言比 main 上的版本少。
 * 只守与 origin/main 合并基点上已存在的测试文件——PR 自己新加的测试允许随代码改删
 * （金丝雀 3/4：按裁决删超范围代码时连带删它的测试被拦；行为由真人 QA + 独立裁判兜底）。
 * 取不到合并基点时退回对照 before（从严）。
 */
async function weakenedTests(worktree, before, head, only = null) {
  // 合并基点要按最新的 main 算（克隆里的 origin/main 可能是旧的）；拉不到就用现有的
  await git(worktree, ['fetch', 'origin', 'main'], { timeoutMs: FETCH_TIMEOUT_MS });
  const mb = await git(worktree, ['merge-base', 'origin/main', head]);
  const base = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : before;
  const atBase = async (file) => (await git(worktree, ['cat-file', '-e', `${base}:${file}`])).code === 0;
  const status = (await git(worktree, ['diff', '--name-status', `${before}..${head}`])).stdout.split('\n').filter(Boolean);
  for (const line of status) {
    const [kind, file] = line.split('\t');
    if (!TEST_FILE_RE.test(file ?? '') || (only && !only.includes(file)) || !(await atBase(file))) continue;
    if (kind === 'D') return true;
    const added = (await git(worktree, ['diff', '-U0', `${before}..${head}`, '--', file])).stdout
      .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    if (added.some((l) => SKIP_RE.test(l))) return true;
    const old = (await git(worktree, ['show', `${base}:${file}`])).stdout;
    const now = (await git(worktree, ['show', `${head}:${file}`])).stdout;
    if (assertCount(now) < assertCount(old)) return true;
  }
  return false;
}

const names = async (worktree, range) => (await git(worktree, ['diff', '--name-only', range])).stdout.split('\n').filter(Boolean);

/**
 * before..HEAD 里 PR 自身的改动：合进了 mainRef 时只算合并后仍与 mainRef 不同的文件
 * （main 带进来的 sprints/、测试等不算本 PR 的改动）；不传 mainRef 即 before..HEAD 全部。
 */
export async function ownChangedFiles(worktree, before, mainRef = null) {
  const changed = await names(worktree, `${before}..HEAD`);
  if (!mainRef) return changed;
  const own = new Set(await names(worktree, `${mainRef}..HEAD`));
  return changed.filter((f) => own.has(f));
}

/**
 * claude 修复后的核对：工作区干净、有新提交、只追加不改写、不碰受保护路径、不削弱测试。通过返回 { commits }，否则抛 Error(reason_code)。
 * mainRef：本次合进了 main（冲突修复），受保护路径与削弱测试只核对 PR 自身的改动。
 */
export async function checkFixCommits(worktree, before, { mainRef = null } = {}) {
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim()) throw stop('uncommitted');
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head || head === before) throw stop('no_commit');
  if ((await git(worktree, ['merge-base', '--is-ancestor', before, head])).code !== 0) throw stop('history_rewritten');
  const changed = await ownChangedFiles(worktree, before, mainRef);
  if (changed.some((f) => PROTECTED_RE.test(f))) throw stop('protected_path');
  if (await weakenedTests(worktree, before, head, mainRef ? changed : null)) throw stop('test_weakened');
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
