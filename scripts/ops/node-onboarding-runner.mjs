import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 独立进程组可在超时/取消时同时清理 SSH 和其子进程，stderr 永不进入回执。
export function runCommand(command, args, { input = '', timeoutMs = 15000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false, env: { ...process.env, LC_ALL: 'C' } });
    let stdout = ''; let finished = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const finish = (error, code) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { kill(); reject(new Error('命令执行失败')); } else resolve({ stdout, code });
    };
    const abort = () => finish(true);
    const timer = setTimeout(abort, Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(true));
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1024 * 1024) finish(true); });
    child.stdin.on('error', () => {});
    child.on('close', code => finish(false, code));
    if (signal?.aborted) abort(); else child.stdin.end(input);
  });
}

// 锁文件不删除：删除正在使用的锁 inode 会允许两个进程同时持锁。
// 内核释放死进程的 flock，新持有者才能清理上一轮遗留的凭据目录。
export function acquireCredentialLock(path, { signal, onLost = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [fileURLToPath(new URL('./node-agent-lock.py', import.meta.url)), path, String(process.pid)], { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    let acquired = false; let releasing = false; let settled = false; let output = ''; let releasePromise;
    const closed = new Promise(done => child.once('close', done));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => {
      if (settled) return;
      settled = true; cleanup(); child.kill('SIGKILL'); reject(new Error('凭据互斥锁不可用'));
    };
    const timer = setTimeout(abort, 5000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.on('error', () => {});
    child.on('error', abort);
    child.on('close', () => { if (!acquired) abort(); else if (!releasing) onLost(); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (settled || !output.includes('\n')) return;
      if (output.trim() !== 'READY') { abort(); return; }
      acquired = true; settled = true; cleanup();
      resolve(() => {
        if (!releasePromise) {
          releasing = true; child.stdin.end();
          const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
          releasePromise = closed.finally(() => clearTimeout(timeout));
        }
        return releasePromise;
      });
    });
    if (signal?.aborted) abort();
  });
}
