import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只读取已有私有缓存中的单一赋值；不执行 shell，不修改父进程环境。
async function opEnvironment(env) {
  if (env.OP_SERVICE_ACCOUNT_TOKEN?.trim()) return env;
  const unsafe = () => new Error('1Password 凭据缓存不安全或格式无效');
  let file;
  try {
    const directory = join(await realpath(homedir()), '.credentials');
    let parent;
    try { parent = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return env; throw error; }
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o7777) !== 0o700) throw unsafe();
    try { file = await open(join(directory, '1password.env'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return env; throw error; }
    const before = await file.stat();
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600
      || before.nlink !== 1 || before.size < 1 || before.size > 16384) throw unsafe();
    const buffer = Buffer.alloc(16385);
    let source;
    try {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const after = await file.stat(); const currentParent = await lstat(directory);
      if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.mode !== before.mode || after.uid !== before.uid || after.nlink !== 1
        || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino || currentParent.mode !== parent.mode) throw unsafe();
      source = buffer.toString('utf8', 0, bytesRead);
    } finally { buffer.fill(0); }
    let token;
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\s+)?OP_SERVICE_ACCOUNT_TOKEN\s*=\s*(?:([A-Za-z0-9_./+=-]+)|'([A-Za-z0-9_./+=-]+)'|"([A-Za-z0-9_./+=-]+)")$/.exec(line);
      if (!match || token !== undefined) throw unsafe();
      token = match[1] || match[2] || match[3];
    }
    if (!token) throw unsafe();
    return { ...env, OP_SERVICE_ACCOUNT_TOKEN: token };
  } catch { throw unsafe(); }
  finally { if (file) await file.close(); }
}

// 独立进程组可在超时/取消时同时清理 SSH 和其子进程，stderr 永不进入回执。
export async function runCommand(command, args, { input = '', timeoutMs = 15000, signal } = {}) {
  let env = { ...process.env, LC_ALL: 'C' };
  if (command === 'op') env = await opEnvironment(env);
  if (signal?.aborted) throw new Error('命令执行失败');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false, env });
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
