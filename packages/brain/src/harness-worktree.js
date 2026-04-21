import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, rm } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';

async function defaultStat(p) {
  try { await stat(p); return true; } catch { return false; }
}

function defaultExec(cmd, args, opts = {}) {
  // git clone 拷贝 cecelia 主仓库（4000+ 文件 ~GB）实测 3-5min，60s 不够
  // 提到 10min 给 clone 留 buffer；其他 git 命令快，本 timeout 只是兜底
  return execFile(cmd, args, { timeout: 600_000, ...opts });
}

async function defaultRm(p) {
  await rm(p, { recursive: true, force: true });
}

function shortId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`ensureHarnessWorktree: taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}

/**
 * 幂等创建/复用 Harness v2 专属独立 git clone。
 *
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
 * 分支：harness-v2/task-<shortid>（基于 main）
 *
 * 用独立 clone（而非 git worktree add）产出 self-contained repo，
 * 容器挂载 worktree 后所有 git 操作可用。
 *
 * @param {object} opts
 * @param {string} opts.taskId                必填，用前 8 字符
 * @param {string} [opts.initiativeId]        仅用于日志
 * @param {string} [opts.baseRepo]
 * @param {Function} [opts.execFn]            测试注入
 * @param {Function} [opts.statFn]            测试注入
 * @param {Function} [opts.rmFn]              测试注入
 * @returns {Promise<string>}                  worktree 绝对路径
 */
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;
  const rmFn = opts.rmFn || defaultRm;

  const sid = shortId(opts.taskId);
  const branch = `harness-v2/task-${sid}`;
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    try {
      const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(stdout || '').trim() === 'true') return wtPath;
    } catch { /* not a git repo, fall through to cleanup + re-clone */ }
    await rmFn(wtPath);
  }

  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    baseRepo, wtPath,
  ]);
  await execFn('git', ['-C', wtPath, 'checkout', '-b', branch]);
  return wtPath;
}

/**
 * 移除 Harness v2 独立 clone；幂等（不存在不抛）。
 *
 * @param {string} wtPath
 * @param {object} [opts]
 * @param {Function} [opts.rmFn]
 */
export async function cleanupHarnessWorktree(wtPath, opts = {}) {
  const rmFn = opts.rmFn || defaultRm;
  try {
    await rmFn(wtPath);
  } catch { /* idempotent */ }
}
