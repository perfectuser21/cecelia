// 启动器专用进程组：异步命令可取消；终止前记录不同组的后代，收割后才归还调用方。
import { spawn, spawnSync } from 'node:child_process';

export function runtimeProcess(bin, args, { env = process.env, cwd, signal, timeoutMs = 60000, graceMs = 1000, inherit = false } = {}) {
  if (signal?.aborted) return Promise.resolve({ code: null, aborted: true, stdout: '', stderr: '' });
  return new Promise(resolve => {
    const child = spawn(bin, args, { env, cwd, detached: true, stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopping = false, finished = false, killTimer, scanTimer, exited = false;
    const descendants = new Set();
    const collect = () => {
      const out = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 }).stdout || '';
      const rows = out.trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
      let added;
      do {
        added = false;
        for (const [pid, ppid] of rows) if (pid > 0 && !descendants.has(pid) && (ppid === child.pid || descendants.has(ppid))) { descendants.add(pid); added = true; }
      } while (added);
    };
    const killAll = sig => {
      if (child.pid) { try { process.kill(-child.pid, sig); } catch {} }
      for (const pid of descendants) { try { process.kill(pid, sig); } catch {} }
    };
    const finish = code => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(killTimer); clearInterval(scanTimer);
      signal?.removeEventListener('abort', stop);
      if (stopping) { collect(); killAll('SIGKILL'); }
      resolve({ code, aborted: signal?.aborted === true, terminated: stopping, stdout, stderr });
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true; collect(); killAll('SIGTERM');
      scanTimer = setInterval(collect, 100);
      killTimer = setTimeout(() => { collect(); killAll('SIGKILL'); if (exited) finish(null); }, graceMs);
    };
    const timer = timeoutMs ? setTimeout(stop, timeoutMs) : null;
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    if (!inherit) {
      child.stdout.on('data', data => { stdout += data; if (stdout.length > 8 * 1024 * 1024) stop(); });
      child.stderr.on('data', data => { stderr += data; if (stderr.length > 8 * 1024 * 1024) stop(); });
    }
    child.once('error', () => finish(null));
    child.once('exit', () => { exited = true; if (stopping) { collect(); killAll('SIGKILL'); } });
    child.once('close', code => finish(code));
  });
}
