// 启动器专用进程组：异步命令可取消；终止前记录不同组的后代，收割后才归还调用方。
import { spawn, spawnSync } from 'node:child_process';

function processes() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8', timeout: 1000 });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start: match[4] }] : [];
  });
}

// 只向出生标识仍匹配的进程发信号；组长退出时需有仍匹配的已知组员证明组归属。
export function signalOwned(leader, owned, snapshot, signal, send = process.kill.bind(process)) {
  const current = new Map(snapshot.map(row => [row.pid, row]));
  const root = current.get(leader);
  const groupOwned = root ? owned.get(leader) === root.start
    : snapshot.some(row => row.pgid === leader && owned.get(row.pid) === row.start);
  if (groupOwned) { try { send(-leader, signal); } catch {} }
  let changed = false;
  for (const [pid, start] of owned) {
    const row = current.get(pid);
    if (!row) continue;
    if (row.start !== start) { changed = true; continue; }
    if (groupOwned && row.pgid === leader) continue;
    try { send(pid, signal); } catch {}
  }
  return changed;
}

export function runtimeProcess(bin, args, { env = process.env, cwd, signal, timeoutMs = 60000, graceMs = 1000, inherit = false } = {}) {
  if (signal?.aborted) return Promise.resolve({ code: null, aborted: true, stdout: '', stderr: '' });
  return new Promise(resolve => {
    const child = spawn(bin, args, { env, cwd, detached: true, stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopping = false, finished = false, killTimer, scanTimer, exited = false;
    const owned = new Map();
    let ownershipChanged = false;
    const initial = processes();
    const root = initial.find(row => row.pid === child.pid);
    if (root) owned.set(root.pid, root.start);
    const collect = () => {
      const rows = processes();
      const current = new Map(rows.map(row => [row.pid, row]));
      let added;
      do {
        added = false;
        for (const row of rows) {
          const parent = current.get(row.ppid);
          // PID复用的新父进程不能把旁人的子树纳入归属集合。
          if (!owned.has(row.pid) && parent && owned.get(parent.pid) === parent.start) {
            owned.set(row.pid, row.start); added = true;
          }
        }
      } while (added);
    };
    const killAll = sig => { ownershipChanged = signalOwned(child.pid, owned, processes(), sig) || ownershipChanged; };
    const finish = code => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(killTimer); clearInterval(scanTimer);
      signal?.removeEventListener('abort', stop);
      if (stopping) { collect(); killAll('SIGKILL'); }
      if (ownershipChanged) console.error('runtime_process_ownership_changed_not_signalled');
      resolve({ code: ownershipChanged ? null : code, ownershipChanged, aborted: signal?.aborted === true, terminated: stopping, stdout, stderr });
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
