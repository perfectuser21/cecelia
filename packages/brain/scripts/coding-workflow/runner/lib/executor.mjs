// 跑通用执行器 activity-contract-run.js：stdin 写信封，stdout 收终态，stderr 落日志文件，总超时兜底。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runnerChildEnv } from './proc.mjs';

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* 已退出 */ }
  }
}

/**
 * 运行执行器。返回 { code, stdout, timedOut, aborted }。
 * 执行器自成进程组（detached）：超时/中止先 SIGTERM 让它优雅收尾（它会中止活动子进程并写终态），
 * killGraceMs 后对整个进程组 SIGKILL，不留 claude 等孤儿。
 */
export function runExecutor({ executor, cwdDir, worktree, envelope, receiptPath, logPath, timeoutMs, killGraceMs, signal }) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  // 旧回执可能是上一次运行的终态，必须清掉，避免崩溃时被误读
  fs.rmSync(receiptPath, { force: true });
  const logFd = fs.openSync(logPath, 'a');

  return new Promise((resolve) => {
    let stdout = '';
    let timedOut = false;
    let aborted = false;
    let killTimer = null;
    const child = spawn(process.execPath, [executor, '--cwd', cwdDir, '--receipt', receiptPath], {
      cwd: worktree,
      env: runnerChildEnv(),
      stdio: ['pipe', 'pipe', logFd],
      detached: true,
    });

    const stop = () => {
      killGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), killGraceMs);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    signal?.addEventListener('abort', onAbort, { once: true });

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      // 执行器已退出：进程组里残留的活动子进程一并清掉（尽力而为）
      if (timedOut || aborted) killGroup(child.pid, 'SIGKILL');
      fs.closeSync(logFd);
      resolve({ code, stdout, timedOut, aborted });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    // 执行器提前退出时写 stdin 会 EPIPE，忽略即可（结果由退出码与 stdout 判定）
    child.stdin.on('error', () => {});
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    child.stdin.end(JSON.stringify(envelope));
  });
}
