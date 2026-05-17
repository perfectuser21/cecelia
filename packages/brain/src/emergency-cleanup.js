/**
 * Emergency Cleanup — Brain 应激机制 Phase 2
 *
 * Watchdog kill 进程后（Phase 1），立即调用此模块清理残留：
 *   - git worktree remove（防止磁盘占用累积）
 *   - lock slot 清理（释放 /tmp/cecelia-locks/slot-N）
 *   - .dev-mode 文件清理
 *
 * 设计原则：
 *   - 全部 execSync，零额外内存开销
 *   - 每步独立 try/catch，一步失败不影响其他步骤
 *   - 纯同步，不 spawn 长期子进程
 *   - 失败步骤最多重试 2 次（间隔 5s），耗尽后上报 cleanup_failed 事件
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';
const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
const REPO_ROOT = process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 5000;

// 累计统计（进程生命周期内）
const _stats = { total_calls: 0, success: 0, failed: 0, retried: 0 };

/**
 * 同步等待指定毫秒（用于重试间隔）
 * @param {number} ms
 */
function syncSleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // fallback: no-op if SharedArrayBuffer unavailable
  }
}

/**
 * 带重试的步骤执行器
 * @param {string} stepName
 * @param {Function} fn
 * @param {{ maxRetries?: number, retryDelayMs?: number, emit?: Function|null }} opts
 * @returns {{ ok: boolean, errors: string[] }}
 */
function runWithRetry(stepName, fn, { maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, emit = null } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      fn();
      if (attempt > 0) _stats.retried++;
      return { ok: true, errors: [] };
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        console.warn(`[emergency-cleanup] step=${stepName} attempt=${attempt + 1}/${maxRetries + 1} failed, retrying in ${retryDelayMs}ms:`, e.message);
        syncSleep(retryDelayMs);
      }
    }
  }

  const errMsg = lastError?.message || 'unknown error';
  console.error(`[emergency-cleanup] step=${stepName} failed after ${maxRetries + 1} attempts:`, errMsg);

  if (emit) {
    try {
      emit('cleanup_failed', 'emergency-cleanup', { step: stepName, error: errMsg });
    } catch { /* ignore emit errors */ }
  }

  return { ok: false, errors: [errMsg] };
}

/**
 * 返回累计清理统计
 * @returns {{ total_calls: number, success: number, failed: number, retried: number }}
 */
function getCleanupStats() {
  return { ..._stats };
}

/**
 * Phase 2 emergency cleanup after watchdog kills a task process.
 *
 * @param {string} taskId - The killed task ID
 * @param {string} slot - Lock slot name (e.g. 'slot-0')
 * @param {{ emit?: Function|null, maxRetries?: number, retryDelayMs?: number }} [options]
 * @returns {{ worktree: boolean, lock: boolean, devMode: boolean, errors: string[] }}
 */
function emergencyCleanup(taskId, slot, { emit = null, maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  _stats.total_calls++;
  const result = { worktree: false, lock: false, devMode: false, errors: [] };
  const retryOpts = { maxRetries, retryDelayMs, emit };

  // 1. Find worktree path
  let worktreePath = null;
  try {
    const slotDir = join(LOCK_DIR, slot);
    const infoPath = join(slotDir, 'info.json');

    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        worktreePath = info.worktree_path || null;
      } catch { /* corrupt json */ }
    }

    if (!worktreePath) {
      worktreePath = findWorktreeForTask(taskId);
    }
  } catch (e) {
    result.errors.push(`worktree-scan: ${e.message}`);
  }

  // 2. Clean .dev-mode file (with retry)
  if (worktreePath && existsSync(worktreePath)) {
    const devModePath = join(worktreePath, '.dev-mode');
    if (existsSync(devModePath)) {
      const devResult = runWithRetry('devMode', () => rmSync(devModePath), retryOpts);
      result.devMode = devResult.ok;
      result.errors.push(...devResult.errors);
    }

    // 3. Remove git worktree (with retry, fallback to manual rm)
    const wtResult = runWithRetry('worktree', () => {
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          cwd: REPO_ROOT, timeout: 15000, stdio: 'pipe',
        });
      } catch {
        // Fallback: manual removal
        rmSync(worktreePath, { recursive: true, force: true });
        execSync('git worktree prune', { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
      }
    }, retryOpts);
    result.worktree = wtResult.ok;
    result.errors.push(...wtResult.errors);
  }

  // 4. Clean lock slot directory (with retry)
  const slotDir = join(LOCK_DIR, slot);
  if (existsSync(slotDir)) {
    const lockResult = runWithRetry('lock', () => rmSync(slotDir, { recursive: true, force: true }), retryOpts);
    result.lock = lockResult.ok;
    result.errors.push(...lockResult.errors);
  }

  if (result.errors.length > 0) {
    _stats.failed++;
    console.warn(`[emergency-cleanup] task=${taskId} slot=${slot} errors:`, result.errors);
  } else {
    _stats.success++;
    console.log(`[emergency-cleanup] task=${taskId} slot=${slot} cleaned (wt=${result.worktree} lock=${result.lock} dev=${result.devMode})`);
  }

  return result;
}

/**
 * Find worktree directory for a given taskId by scanning worktree directories.
 * Looks for .dev-mode files or info.json references.
 */
function findWorktreeForTask(taskId) {
  try {
    if (!existsSync(WORKTREE_BASE)) return null;
    const entries = readdirSync(WORKTREE_BASE, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wtPath = join(WORKTREE_BASE, entry.name);
      const devMode = join(wtPath, '.dev-mode');
      if (existsSync(devMode)) {
        try {
          const content = readFileSync(devMode, 'utf-8');
          if (content.includes(taskId)) return wtPath;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export { emergencyCleanup, findWorktreeForTask, getCleanupStats };
