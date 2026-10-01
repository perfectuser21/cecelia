import { spawn } from 'node:child_process';

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
