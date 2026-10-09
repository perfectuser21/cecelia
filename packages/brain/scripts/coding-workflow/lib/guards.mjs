// build / verify 的防篡改与防误操作检查：md 链哈希、远端分支快照、历史与分支、提交改动清单、agent 配置、隐藏 03。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitOut, gitRun } from './claude.mjs';
import { fail } from './protocol.mjs';

// 上下文里各链文件的哈希键（intent/spec 活动产出）
const CHAIN_HASH_KEYS = [
  ['01-intent.md', 'intent_sha256'],
  ['02-spec.md', 'spec_sha256'],
];

/** 文件内容 sha256（hex）；不存在返回 null。 */
export function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 上下文给了哈希、但当前内容（或存在性）对不上的链文件。 */
export function tamperedChainFiles(dir, input) {
  return CHAIN_HASH_KEYS
    .filter(([file, key]) => typeof input?.[key] === 'string' && sha256File(path.join(dir, file)) !== input[key])
    .map(([file]) => file);
}

/** 01/02 被改 → fatal chain_tampered（evidence 列出文件），否则 null。 */
export function chainTamperFailure(dir, input) {
  const tampered = tamperedChainFiles(dir, input);
  return tampered.length > 0 ? fail('fatal', 'chain_tampered', { evidence: [{ tampered_files: tampered }] }) : null;
}

/** 远端分支快照：查询失败时重试一次，仍失败返回 null。 */
export async function remoteSnapshot(worktree) {
  return (await remoteHead(worktree)) ?? remoteHead(worktree);
}

/**
 * 与运行前快照比对远端分支：任一侧查不到（null）→ retryable remote_check_failed（不臆断变了没变）；
 * 不同 → fatal remote_changed；相同 → null。evidence 带前后 SHA。
 */
export async function remoteChangeFailure(worktree, remoteBefore) {
  const remoteAfter = await remoteSnapshot(worktree);
  const evidence = [{ remote_before: remoteBefore, remote_after: remoteAfter }];
  if (remoteBefore === null || remoteAfter === null) return fail('retryable', 'remote_check_failed', { evidence });
  return remoteAfter === remoteBefore ? null : fail('fatal', 'remote_changed', { evidence });
}

/** 当前分支名；detached 或失败返回 null。 */
export async function currentBranch(worktree) {
  const out = (await gitOut(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  return out && out !== 'HEAD' ? out : null;
}

/**
 * origin 上当前分支的 SHA：没有配置 origin、detached 或远端没有该分支返回空串（无可保护对象）；
 * origin 已配置但 ls-remote 失败返回 null。
 */
export async function remoteHead(worktree) {
  const branch = await currentBranch(worktree);
  if (!branch || (await gitOut(worktree, ['remote', 'get-url', 'origin'])) === null) return '';
  const out = await gitOut(worktree, ['ls-remote', 'origin', `refs/heads/${branch}`]);
  return out === null ? null : out.trim().split(/\s+/)[0] ?? '';
}

/** sha 是否为当前 HEAD 的祖先（含相等）；git 执行失败（如对象不存在）返回 null。 */
export async function isAncestor(worktree, sha) {
  const { code } = await gitRun(worktree, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  if (code === 0) return true;
  return code === 1 ? false : null;
}

/** from..HEAD 之间改过的文件（相对仓库根）；pathspec 给定时只看该路径。git 执行失败返回 null。 */
export async function changedFilesSince(worktree, from, pathspec) {
  const args = ['diff', '--name-only', `${from}..HEAD`, ...(pathspec ? ['--', pathspec] : [])];
  const out = await gitOut(worktree, args);
  return out === null ? null : out.split('\n').filter(Boolean);
}

/** 会改变后续 claude 会话行为的 agent 配置：任意层级的 .claude/ 目录、CLAUDE.md、AGENTS.md。 */
export function agentConfigFiles(paths) {
  return paths.filter((p) => {
    const parts = p.split('/');
    return parts.slice(0, -1).includes('.claude') || ['CLAUDE.md', 'AGENTS.md'].includes(parts.at(-1));
  });
}

const HOLDER_DIR = 'coding-wf';

/** file 在 `<git-dir>/coding-wf/` 下的暂存路径；拿不到 git 目录返回 null。 */
async function holderPath(worktree, file) {
  const gitDir = (await gitOut(worktree, ['rev-parse', '--absolute-git-dir']))?.trim();
  return gitDir ? path.join(gitDir, HOLDER_DIR, path.basename(file)) : null;
}

/** 把暂存件放回 file（覆盖期间新写的同名文件）并删暂存件。 */
function moveBack(hidden, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(hidden, file);
  fs.rmSync(hidden, { force: true });
}

/**
 * 把 file 暂移到 `<git-dir>/coding-wf/`（git 不追踪），返回 { hiddenPath, restore }。
 * restore 放回原处，幂等；放回失败返回 false（不抛错），成功或无需放回返回 true。
 * 文件不存在时无操作。拿不到 git 目录时退回系统临时目录。
 */
export async function hideFile(worktree, file) {
  if (!fs.existsSync(file)) return { hiddenPath: null, restore: () => true };
  const hidden = (await holderPath(worktree, file))
    ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-wf-')), path.basename(file));
  fs.mkdirSync(path.dirname(hidden), { recursive: true });
  fs.copyFileSync(file, hidden);
  fs.rmSync(file);
  let restored = false;
  return {
    hiddenPath: hidden,
    restore() {
      if (restored) return true;
      try {
        moveBack(hidden, file);
        restored = true;
      } catch {
        return false;
      }
      return true;
    },
  };
}

/** 上次运行中断时留在 `<git-dir>/coding-wf/` 的暂存件放回 file；放回了返回 true，没有残留返回 false。 */
export async function recoverHidden(worktree, file) {
  const hidden = await holderPath(worktree, file);
  if (!hidden || !fs.existsSync(hidden)) return false;
  moveBack(hidden, file);
  return true;
}
