/**
 * quarantine-active-signal — 给 shepherd quarantine 决策加"活跃信号"预检。
 *
 * 扫 .dev-mode.* 文件 mtime，文件名含 taskId 前 8 位且 mtime < 90s → active。
 * 只读，不改任何 .dev-mode/.dev-lock 字段（遵守 stop-hook-cwd-as-key 规则）。
 *
 * 数据源为何单选 .dev-mode 见 Phase B2 spec §3 排除理由。
 */
import { readdirSync, statSync } from 'fs';
import path from 'path';

const ACTIVE_WINDOW_MS = 90_000;
const WORKTREE_ROOT = '/Users/administrator/worktrees/cecelia';
const MAIN_REPO = '/Users/administrator/perfect21/cecelia';

/**
 * @param {string} taskId UUID 全量
 * @returns {Promise<{active:boolean, reason:string, source:string|null, ageMs:number|null}>}
 */
export async function hasActiveSignal(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    return { active: false, reason: 'invalid_task_id', source: null, ageMs: null };
  }
  const prefix = taskId.slice(0, 8);
  const now = Date.now();

  for (const filePath of collectDevModeFiles()) {
    const basename = path.basename(filePath);
    if (!basename.includes(prefix)) continue;
    let mtimeMs;
    try { mtimeMs = statSync(filePath).mtimeMs; } catch { continue; }
    const ageMs = now - mtimeMs;
    if (ageMs < ACTIVE_WINDOW_MS) {
      console.log(`[quarantine-active-signal] bypass quarantine: ${basename} age=${Math.round(ageMs)}ms`);
      return { active: true, reason: 'dev_mode_mtime_fresh', source: filePath, ageMs };
    }
  }
  return { active: false, reason: 'no_fresh_dev_mode', source: null, ageMs: null };
}

function collectDevModeFiles() {
  const files = [];
  try {
    for (const f of readdirSync(MAIN_REPO)) {
      if (f.startsWith('.dev-mode.')) files.push(path.join(MAIN_REPO, f));
    }
  } catch { /* main repo 不可读时忽略 */ }
  try {
    for (const wt of readdirSync(WORKTREE_ROOT)) {
      const dir = path.join(WORKTREE_ROOT, wt);
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('.dev-mode.')) files.push(path.join(dir, f));
        }
      } catch { /* 单个 worktree 不可读时忽略 */ }
    }
  } catch { /* worktree root 不存在时忽略 */ }
  return files;
}
