import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { makeCpBranchName, shortTaskId } from './harness-utils.js';

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

/**
 * 幂等创建/复用 Harness v2 专属独立 git clone。
 *
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
 * 分支：cp-<MMDDHHMM>-ws-<shortid>（基于 main，强制 cp-* 规约）
 *
 * 设计决策：
 *   - 目录名仍保留 `harness-v2/task-<shortid>` 作为 Brain 内部位置，与 Generator
 *     挂载路径兼容（docker-executor 按目录找 worktree）。
 *   - 分支名强制 `cp-MMDDHHMM-ws-<shortid>`（符合 hooks/branch-protect.sh 正则 +
 *     CI branch-naming 规则），Generator 收到时已在合规分支，不需要再 checkout -b。
 *   - clone 之后自动 `fetch origin main` 并尝试 `rebase origin/main`；失败则 log
 *     + skip（让 Generator 遇到冲突时自行处理，不 block Initiative）。
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
 * @param {Date|number} [opts.now]            测试注入（makeCpBranchName 的时间）
 * @param {Function} [opts.logFn]             测试注入（默认 console.warn）
 * @returns {Promise<string>}                  worktree 绝对路径
 */
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;
  const rmFn = opts.rmFn || defaultRm;
  const logFn = opts.logFn || ((msg) => console.warn(msg));

  const sid = shortTaskId(opts.taskId);
  const branch = makeCpBranchName(opts.taskId, { now: opts.now });
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    // 状态机校验（修补 W7.3 cleanupStaleWorktrees race 留下的孤儿 dir）：
    //   1) rev-parse --is-inside-work-tree → 是不是 git repo
    //   2) remote get-url origin → origin 是否指向 baseRepo（防孤儿独立 repo）
    // 任一失败 → rm -rf 整个 dir + 重新 clone
    //
    // 为什么需要 (2)：cleanup race 后留下的 dir 里可能有独立的 .git 目录（不是
    // baseRepo 的 clone），rev-parse 仍返回 true，但 docker mount 这个 worktree
    // 起容器时会 27ms 内 exit 125（容器初始化失败：缺 origin、无 main 分支）。
    let isOrphan = false;
    try {
      const { stdout: inside } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(inside || '').trim() !== 'true') {
        isOrphan = true;
      } else {
        // 校验 origin remote URL 必须指向 baseRepo（绝对路径或仓库 URL 任一段匹配）
        try {
          const { stdout: remoteUrl } = await execFn('git', ['-C', wtPath, 'remote', 'get-url', 'origin']);
          const url = String(remoteUrl || '').trim();
          if (!url || !url.includes(baseRepo)) {
            logFn(`[harness-worktree] orphan worktree at ${wtPath}: origin='${url}' does not match baseRepo='${baseRepo}'; rebuilding`);
            isOrphan = true;
          }
        } catch (err) {
          logFn(`[harness-worktree] orphan worktree at ${wtPath}: origin remote missing (${err.message}); rebuilding`);
          isOrphan = true;
        }
      }
    } catch {
      // not a git repo at all
      isOrphan = true;
    }

    if (!isOrphan) {
      // 目录已是合法 git repo；检查当前分支是否已符合 cp-* 规约。
      // 若是旧的 harness-v2/task-* 分支，强制切到新的 cp-* 分支（保证 Generator 收到合规分支）。
      try {
        const { stdout: cur } = await execFn('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
        const currentBranch = String(cur || '').trim();
        if (!/^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/.test(currentBranch)) {
          logFn(`[harness-worktree] non-cp branch '${currentBranch}' detected at ${wtPath}; checking out ${branch}`);
          await execFn('git', ['-C', wtPath, 'checkout', '-B', branch]);
        }
      } catch (err) {
        logFn(`[harness-worktree] could not verify branch at ${wtPath}: ${err.message}`);
      }
      return wtPath;
    }

    await rmFn(wtPath);
  }

  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    baseRepo, wtPath,
  ]);
  await execFn('git', ['-C', wtPath, 'checkout', '-b', branch]);

  // 尝试 rebase origin/main，让 Generator 从最新 main 出发；
  // fetch/rebase 任一失败只 log warn，不抛（兄弟 worktree 可能改了同文件冲突，
  // 让 Generator 进入后自行处理，不 block Initiative）。
  try {
    await execFn('git', ['-C', wtPath, 'fetch', 'origin', 'main']);
    await execFn('git', ['-C', wtPath, 'rebase', 'origin/main']);
  } catch (err) {
    logFn(`[harness-worktree] rebase origin/main skipped for ${wtPath}: ${err.message}`);
    // rebase 可能留下 REBASE_HEAD，abort 一下免得仓库处于半成品状态
    try { await execFn('git', ['-C', wtPath, 'rebase', '--abort']); } catch { /* best-effort */ }
  }

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
