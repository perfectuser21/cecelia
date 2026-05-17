/**
 * cleanup-lock — 跨进程 worktree 清理互斥锁
 *
 * 用 mkdir(2) 原子语义实现 — POSIX 保证 mkdir 同名 EEXIST，跨 macOS/Linux 不依赖 flock(1)。
 * 解决 audit 找出的根因：7 个清理脚本（zombie-cleaner / zombie-sweep / startup-recovery /
 * cleanup-merged-worktrees / cecelia-run cleanup trap / janitor / emergency-cleanup）
 * 无全局 lock 并发删 worktree → `.git/worktrees` 元数据撕坏 → cwd 不识别 git。
 *
 * 设计：
 * - 锁是 mkdir 创的目录 /tmp/cecelia-cleanup.lock
 * - acquire spinpoll，timeout/retry 可调
 * - stale 检测：lock 目录 mtime > staleMs 视为 crash 残留，强夺
 * - withLock 包裹 fn，异常路径自动 release
 * - bash 脚本对应 helper：scripts/cleanup-lock.sh（同套 mkdir/rmdir 协议）
 */

import { mkdirSync, rmdirSync, statSync, existsSync } from 'fs';

export const LOCK_DIR_DEFAULT = '/tmp/cecelia-cleanup.lock';
const TIMEOUT_MS_DEFAULT = 30 * 1000;
const RETRY_MS_DEFAULT = 100;
const STALE_MS_DEFAULT = 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 尝试拿锁。spinpoll 直到超时。
 *
 * @param {object} opts
 * @param {string} [opts.lockDir]   锁目录路径（默认 /tmp/cecelia-cleanup.lock）
 * @param {number} [opts.timeoutMs] 总超时（默认 30s）
 * @param {number} [opts.retryMs]   重试间隔（默认 100ms）
 * @param {number} [opts.staleMs]   超过此 mtime 视为 stale 强夺（默认 60s）
 * @returns {Promise<boolean>}      true = 拿到，false = 超时
 */
export async function acquireLock(opts = {}) {
  const lockDir = opts.lockDir || LOCK_DIR_DEFAULT;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS_DEFAULT;
  const retryMs = opts.retryMs ?? RETRY_MS_DEFAULT;
  const staleMs = opts.staleMs ?? STALE_MS_DEFAULT;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync(lockDir);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // stale 检测：lock 目录 mtime 老于 staleMs → crash 残留，强夺
      try {
        const ageMs = Date.now() - statSync(lockDir).mtimeMs;
        if (ageMs > staleMs) {
          console.warn(`[cleanup-lock] breaking stale lock (age=${Math.round(ageMs / 1000)}s, threshold=${staleMs / 1000}s)`);
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        // stat 失败（lock 已被别人 release）→ 直接 retry
      }

      await sleep(retryMs);
    }
  }
  return false;
}

/**
 * 释放锁（idempotent — 锁已不存在不报错）。
 */
export function releaseLock(opts = {}) {
  const lockDir = opts.lockDir || LOCK_DIR_DEFAULT;
  if (existsSync(lockDir)) {
    try { rmdirSync(lockDir); } catch { /* ignore */ }
  }
}

/**
 * withLock — 拿锁、跑 fn、释放锁（异常路径也释放）。
 *
 * @param {object} opts          同 acquireLock
 * @param {Function} fn          异步 / 同步函数，无参数
 * @returns {Promise<*|null>}    fn 返回值；拿不到锁返回 null
 */
export async function withLock(opts, fn) {
  const ok = await acquireLock(opts);
  if (!ok) {
    console.warn('[cleanup-lock] timeout, skipping operation');
    return null;
  }
  try {
    return await fn();
  } finally {
    releaseLock(opts);
  }
}
