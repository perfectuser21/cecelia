/**
 * host-executor.js — mac_web 环境专用：直接在宿主 Mac 上运行 Claude Code
 *
 * 适用场景：target_environment=mac_web（Cecelia Dashboard，localhost:5174/5221 直接可达）
 * 区别于 docker-executor：不创建容器，Claude 进程在 Mac host 直接运行，
 * 因此 Playwright 可访问真实浏览器 + localhost:5174 Dashboard。
 *
 * WORKSPACE_PATH env var：告知 evaluator SKILL 把 .brain-result.json 写到哪里
 * （Docker 默认 /workspace，host 执行时为 worktreePath）。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_PROMPT_DIR = process.env.CECELIA_HOST_PROMPT_DIR || '/tmp/cecelia-host-prompts';
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000; // 90 min

/**
 * Runs Claude Code directly on the Mac host (no Docker container).
 * Prompt is passed via stdin to avoid OS argv length limits.
 * Returns the same result shape as executeInDocker.
 *
 * @param {object} opts
 * @param {object} opts.task       { id, task_type }
 * @param {string} opts.prompt     Agent prompt
 * @param {string} [opts.worktreePath]  cwd for claude process
 * @param {object} [opts.env]      Extra env vars to inject
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{exit_code,stdout,stderr,duration_ms,container,container_id,command,timed_out,started_at,ended_at}>}
 */
export async function executeOnHost(opts) {
  const taskId = opts.task?.id;
  if (!taskId) throw new Error('host-executor: opts.task.id required');
  if (typeof opts.prompt !== 'string') throw new Error('host-executor: opts.prompt required');

  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const worktreePath = opts.worktreePath || opts.worktree?.path || process.cwd();

  // Write prompt to file for debug/audit (same pattern as docker-executor)
  if (!existsSync(HOST_PROMPT_DIR)) mkdirSync(HOST_PROMPT_DIR, { recursive: true });
  writeFileSync(path.join(HOST_PROMPT_DIR, `${taskId}-host.prompt`), opts.prompt, 'utf8');

  // Resolve claude-launch.sh relative to this package
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(thisDir, '../../../..');
  const launcherPath = path.join(repoRoot, 'scripts/claude-launch.sh');

  const env = {
    HOME: process.env.HOME || '/Users/administrator',
    PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    ...process.env,
    ...(opts.env || {}),
    WORKSPACE_PATH: worktreePath,
    CECELIA_TASK_ID: taskId,
    CECELIA_HEADLESS: 'true',
  };

  const useLocalLauncher = existsSync(launcherPath);
  const cmdArgs = useLocalLauncher
    ? ['bash', launcherPath, '--dangerously-skip-permissions', '-p']
    : ['claude', '--dangerously-skip-permissions', '-p'];

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  console.log(`[host-executor] spawn task=${taskId} worktree=${worktreePath} launcher=${useLocalLauncher ? 'claude-launch.sh' : 'claude'}`);

  return new Promise((resolve) => {
    const proc = nodeSpawn(cmdArgs[0], cmdArgs.slice(1), {
      cwd: worktreePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Feed prompt via stdin to avoid shell argv size limits
    proc.stdin.on('error', () => {});
    proc.stdin.write(opts.prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(`[host-executor] timeout task=${taskId} after ${timeoutMs}ms — SIGTERM`);
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5_000);
    }, timeoutMs);

    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      const durationMs = Date.now() - startedAtMs;
      console.log(`[host-executor] done task=${taskId} exit=${code ?? 1} duration=${durationMs}ms`);
      resolve({
        exit_code: timedOut ? 137 : (code ?? 1),
        stdout,
        stderr,
        duration_ms: durationMs,
        container: null,
        container_id: null,
        command: `${cmdArgs.join(' ')} <stdin>`,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      });
    }

    proc.on('exit', finish);
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      console.error(`[host-executor] error task=${taskId}: ${err.message}`);
      resolve({
        exit_code: 1,
        stdout,
        stderr: err.message,
        duration_ms: Date.now() - startedAtMs,
        container: null,
        container_id: null,
        command: `${cmdArgs.join(' ')} <stdin>`,
        timed_out: false,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      });
    });
  });
}
