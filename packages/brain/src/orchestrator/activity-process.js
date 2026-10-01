import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const MAX_OUTPUT = 16 * 1024 * 1024;

// 独立进程组：先 TERM 请求活动自身清理，再在 grace 到期收割进程树。
export function callActivityProcess(activity, input, { cwd, signal, onHeartbeat = async () => {} }) {
  return new Promise(resolveResult => {
    const entry = resolve(cwd, activity.runtime.entry);
    const nodeScript = /\.(?:js|mjs|cjs)$/.test(entry);
    const child = spawn(nodeScript ? process.execPath : entry,
      [...(nodeScript ? [entry] : []), ...(activity.runtime.argv || [])],
      { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', reason = null, graceTimer, heartbeatBusy = false;
    const started = Date.now();
    const kill = kind => {
      if (!child.pid) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, kind); }
      catch (error) { if (error.code !== 'ESRCH') stderr += '\nprocess_signal_failed'; }
    };
    const stop = code => {
      if (reason) return;
      reason = code;
      // JSON活动根负责把取消转换成业务安全边界请求，不向外部动作广播TERM。
      if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') stderr += '\nprocess_signal_failed'; } }
      graceTimer = setTimeout(() => kill('SIGKILL'), (activity.runtime.cleanup_grace_s ?? 5) * 1000);
    };
    const abort = () => stop('run_cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop('activity_timeout'), activity.budget.max_duration_s * 1000);
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try { await onHeartbeat({ elapsed_s: (Date.now() - started) / 1000 }); }
      catch { stop('event_sink_failed'); }
      finally { heartbeatBusy = false; }
    }, activity.budget.heartbeat_s * 1000);
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_OUTPUT) stop('activity_output_overflow');
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => { if (Buffer.byteLength(stderr) < MAX_OUTPUT) stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
    let spawnError = null;
    child.on('error', error => { spawnError = error.code || 'spawn_error'; });
    child.on('close', (exit_code, exit_signal) => {
      clearTimeout(timer); clearTimeout(graceTimer); clearInterval(heartbeat);
      signal?.removeEventListener('abort', abort);
      // 后代可能已经脱离父进程；进程组结束时仍不允许留下同组后台进程。
      kill('SIGKILL');
      resolveResult({ stdout, stderr, exit_code, exit_signal,
        reason_code: reason || spawnError, duration_s: (Date.now() - started) / 1000 });
    });
  });
}
