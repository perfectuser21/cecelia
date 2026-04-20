import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';

async function defaultStat(p) {
  try { await stat(p); return true; } catch { return false; }
}

function defaultExec(cmd, args, opts = {}) {
  return execFile(cmd, args, { timeout: 30_000, ...opts });
}

function shortId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`ensureHarnessWorktree: taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}

/**
 * 幂等创建/复用 Harness v2 专属 worktree。
 *
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
 * 分支：harness-v2/task-<shortid>（base=main）
 *
 * @param {object} opts
 * @param {string} opts.taskId                必填，用前 8 字符
 * @param {string} [opts.initiativeId]        仅用于日志
 * @param {string} [opts.baseRepo]
 * @param {Function} [opts.execFn]            测试注入
 * @param {Function} [opts.statFn]            测试注入
 * @returns {Promise<string>}                  worktree 绝对路径
 */
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;

  const sid = shortId(opts.taskId);
  const branch = `harness-v2/task-${sid}`;
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    try {
      const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(stdout || '').trim() === 'true') return wtPath;
    } catch { /* fall through to re-create */ }
  }

  await execFn('git', ['-C', baseRepo, 'worktree', 'add', wtPath, '-b', branch, 'main']);
  return wtPath;
}

/**
 * 移除 Harness v2 worktree；幂等（不存在不抛）。
 *
 * @param {string} wtPath
 * @param {object} [opts]
 * @param {string} [opts.baseRepo]
 * @param {Function} [opts.execFn]
 */
export async function cleanupHarnessWorktree(wtPath, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  try {
    await execFn('git', ['-C', baseRepo, 'worktree', 'remove', '--force', wtPath]);
  } catch { /* idempotent */ }
}
