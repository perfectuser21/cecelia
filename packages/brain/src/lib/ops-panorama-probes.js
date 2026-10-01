/** 全景页只读进程探测：异步且每个子进程都在预算内硬终止，不导入调度器。 */
import { execFile } from 'child_process';
import { parseEtime } from '../platform-utils.js';

export function runBoundedProbe(file, args, { timeoutMs = 3000, execFileFn = execFile } = {}) {
  return new Promise((resolve) => {
    try {
      execFileFn(file, args, { encoding: 'utf-8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => resolve(error ? null : stdout));
    } catch { resolve(null); }
  });
}

export async function probeRelayContainers(options = {}) {
  const output = await runBoundedProbe('docker', ['ps', '--filter', 'name=cecelia-relay', '--format', '{{.Names}}'],
    { timeoutMs: 4000, ...options });
  return output === null ? null : output.split('\n').filter(Boolean).length;
}

export async function probeProcesses({ platform = process.platform, ...options } = {}) {
  const args = platform === 'darwin' ? ['-ax', '-o', 'pid=,ppid=,etime=,comm=,args=']
    : ['-eo', 'pid=,ppid=,etimes=,comm=,args='];
  const output = await runBoundedProbe('ps', args, { timeoutMs: 3000, ...options });
  const result = { claude_total: 0, codex_total: 0, sessions: { headed: 0, headless: 0 } };
  if (output === null) return result;
  const processes = output.split('\n').map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return null;
    return { pid: Number(fields[0]), ppid: Number(fields[1]), elapsedSec: platform === 'darwin' ? parseEtime(fields[2]) : Number(fields[2]),
      comm: fields[3], args: fields.slice(4).join(' '), line };
  }).filter(Boolean);
  const parents = new Map(processes.map((p) => [p.pid, p.args]));
  for (const proc of processes) {
    // 原全景计数：claude精确comm；codex命令行包含codex且排除grep行。
    if (/codex/.test(proc.line) && !/grep/.test(proc.line)) result.codex_total += 1;
    if (proc.comm !== 'claude') continue;
    result.claude_total += 1;
    // 与slot-allocator的既有口径相同：parent headless标记优先，24h TTL只限制headed。
    const headless = /CECELIA_HEADLESS=true/.test(parents.get(proc.ppid) ?? '')
      || / -p /.test(proc.args) || /^-p /.test(proc.args) || / --print /.test(proc.args);
    if (headless) result.sessions.headless += 1;
    else if (!(proc.elapsedSec > 24 * 60 * 60)) result.sessions.headed += 1;
  }
  return result;
}
