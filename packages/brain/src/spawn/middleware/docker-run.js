/**
 * docker-run middleware — Brain v2 Layer 3（Executor）attempt-loop 内循环的终点。
 * 见 docs/design/brain-orchestrator-v2.md §5.2（内层 attempt-loop 第 d 步）。
 *
 * 职责：接收已经 build 好的 docker args + opts，执行 child_process.spawn('docker', args, ...)，
 * 捕获 stdout/stderr，超时 kill，返回统一 result shape。不做账号选择、不做 cascade、不做 429 判定 —
 * 那些都在外层 middleware。
 *
 * v2 P2 PR 2（本 PR）：纯代码搬家，从 docker-executor.js:437-503 抽出。
 *
 * @param {string[]} args       完整 docker CLI 参数（来自 buildDockerArgs）
 * @param {object}  opts        { taskId, taskType, timeoutMs, name, cidfile, command }
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, container, container_id, command, timed_out, started_at, ended_at }>}
 */
import { spawn as nodeSpawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { readContainerIdFromCidfile } from '../../docker-executor.js';

export async function runDocker(args, opts) {
  const { taskId, taskType, timeoutMs, name, cidfile, command } = opts;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return new Promise((resolve) => {
    const proc = nodeSpawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[docker-run] timeout task=${taskId} after ${timeoutMs}ms — docker kill ${name}`
      );
      nodeSpawn('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.error(`[docker-run] spawn error task=${taskId}: ${err.message}`);
      const endedAt = new Date().toISOString();
      resolve({
        exit_code: -1,
        stdout,
        stderr: stderr + `\n[docker-run] spawn error: ${err.message}`,
        duration_ms: Date.now() - startedAtMs,
        container: name,
        container_id: null,
        command,
        timed_out: false,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      const duration = Date.now() - startedAtMs;
      const endedAt = new Date().toISOString();
      console.log(
        `[docker-run] exit task=${taskId} code=${code} signal=${signal} duration=${duration}ms timed_out=${timedOut}`
      );
      if (String(taskType).startsWith('harness_') && code !== 0) {
        console.log('[docker-run] HARNESS_STDOUT_TAIL:', (stdout || '').slice(-2000));
        console.log('[docker-run] HARNESS_STDERR_TAIL:', (stderr || '').slice(-2000));
      }
      const containerId = readContainerIdFromCidfile(cidfile);
      if (cidfile && existsSync(cidfile)) {
        try { unlinkSync(cidfile); } catch { /* ignore */ }
      }
      resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        container_id: containerId,
        command,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });
  });
}
