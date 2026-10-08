// 跑通用执行器 activity-contract-run.js：stdin 写信封，stdout 收终态，stderr 落日志文件，总超时兜底。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runnerChildEnv } from './proc.mjs';

/** pid 的全部后代（pgrep -P 递归）。activity 子进程与 claude 各自独立进程组，杀进程组杀不到它们。 */
function descendants(pid, seen = new Set()) {
  const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
  for (const line of String(r.stdout || '').split('\n')) {
    const child = Number(line.trim());
    if (Number.isInteger(child) && child > 0 && !seen.has(child)) {
      seen.add(child);
      descendants(child, seen);
    }
  }
  return seen;
}

function signalAll(pids, signal) {
  for (const pid of pids) {
    try { process.kill(pid, signal); } catch { /* 已退出 */ }
  }
}

/**
 * 运行执行器。返回 { code, stdout, timedOut, aborted }。
 * 超时/中止：先按进程树（执行器 + pgrep -P 递归出的全部后代）SIGTERM，让执行器优雅收尾写终态；
 * killGraceMs 后把树（含期间新生的后代）全部 SIGKILL。执行器先退出时，已记下的后代也一并 SIGKILL——
 * 父进程一死后代会被 init 收养、pgrep -P 再也找不到，所以必须在 SIGTERM 前就把整棵树记下来。
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
    const tree = new Set();
    const child = spawn(process.execPath, [executor, '--cwd', cwdDir, '--receipt', receiptPath], {
      cwd: worktree,
      env: runnerChildEnv(),
      stdio: ['pipe', 'pipe', logFd],
      detached: true,
    });

    const collect = () => {
      for (const pid of [child.pid, ...tree]) descendants(pid, tree);
      if (child.pid) tree.add(child.pid);
    };
    const stop = () => {
      if (killTimer) return;
      collect();
      signalAll(tree, 'SIGTERM');
      killTimer = setTimeout(() => { collect(); signalAll(tree, 'SIGKILL'); }, killGraceMs);
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
      if (timedOut || aborted) {
        collect();
        signalAll(tree, 'SIGKILL');
      }
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
