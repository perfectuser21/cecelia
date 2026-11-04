import { stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { shortTaskId } from './harness-utils.js';

// us-vps(Linux) 上没有交互式开发，只有一份 checkout（REPO_ROOT，见 docker-compose.us-vps.yml
// 注释），worktree 物理位置和克隆源都应该是它；macOS(mmv) 上保持硬编码的"活人主仓"路径不变
// （REPO_ROOT 在 macOS 上指向的是另一个"CD 专用部署根"，两者历来是两份不同 checkout）。
export const DEFAULT_BASE_REPO = process.platform === 'linux'
  ? (process.env.REPO_ROOT || '/root/cecelia')
  : '/Users/administrator/perfect21/cecelia';

/**
 * 计算 harness sub-task worktree 路径（SSOT）。
 *
 * <DEFAULT_BASE_REPO>/.claude/worktrees/harness-v2/task-<shortTaskId>
 */
export function harnessTaskWorktreePath(taskId, _opts = {}) {
  return path.join(DEFAULT_BASE_REPO, '.claude', 'worktrees', 'harness-v2', `task-${shortTaskId(taskId)}`);
}

/**
 * Scan .claude/worktrees/harness-v2/ and remove directories older than staleDays.
 * These are full git clones (not git worktrees), so deletion is direct rm -rf.
 *
 * @param {object} [opts]
 * @param {number} [opts.staleDays=7]   Age threshold in days
 * @param {string} [opts.baseRepo]      Override DEFAULT_BASE_REPO (for testing)
 * @returns {Promise<{cleaned: number, errors: number}>}
 */
export async function cleanupStaleHarnessWorktrees(opts = {}) {
  const staleDays = opts.staleDays ?? 7;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const wtBase = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2');

  let cleaned = 0;
  let errors = 0;

  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(wtBase, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(wtBase, entry.name);
      try {
        const s = await stat(fullPath);
        if (now - s.mtimeMs > staleMs) {
          await rm(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        errors++;
      }
    }
  } catch {
    // wtBase does not exist or not readable — nothing to clean
  }

  return { cleaned, errors };
}
