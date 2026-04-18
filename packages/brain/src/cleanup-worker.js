// cleanup-worker.js —— R4 孤儿 worktree 自动清理 Worker
//
// 周期性调用 scripts/cleanup-merged-worktrees.sh 扫描白名单 worktree，
// 清理已 merged PR 的孤儿。所有安全守卫在 shell 脚本中实现，
// 这里只负责：超时保护 + 日志汇报 + DRY_RUN 支持。
//
// 由 tick.js 每 ~10 分钟触发一次。

import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '../scripts/cleanup-merged-worktrees.sh');

// 手动 promisify：因为 mock child_process.exec 后不带 util.promisify.custom symbol，
// 直接用 new Promise + 传统 (err, stdout, stderr) 回调，与 node 原生 exec 一致。
function execPromise(cmd, opts) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * 调用 cleanup shell 脚本。
 * @param {{ dryRun?: boolean, graceSeconds?: number, timeoutMs?: number }} opts
 * @returns {Promise<{success: boolean, stdout?: string, stderr?: string, error?: string}>}
 */
export async function runCleanupWorker(opts = {}) {
  const { dryRun = false, graceSeconds, timeoutMs = 120_000 } = opts;
  const env = { ...process.env };
  if (dryRun) env.DRY_RUN = '1';
  if (graceSeconds !== undefined) env.GRACE_SECONDS = String(graceSeconds);

  try {
    const { stdout, stderr } = await execPromise(`bash ${SCRIPT_PATH}`, {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

export default runCleanupWorker;
