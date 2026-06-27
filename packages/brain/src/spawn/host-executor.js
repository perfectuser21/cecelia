/**
 * host-executor.js — mac_web 环境专用：在宿主 Mac 上运行 Claude Code
 *
 * 适用场景：target_environment=mac_web（Cecelia Dashboard，localhost:5174/5221 直接可达）
 * 区别于 docker-executor：Claude 进程在 Mac host 运行，
 * 因此 Playwright 可访问真实浏览器 + localhost:5174 Dashboard。
 *
 * ⚠️ 关键：Brain 本身跑在 docker 容器（cecelia-node-brain）里。容器内无 claude、
 * PATH 无 /opt/homebrew/bin —— 直接 spawn('claude') 必然 `spawn claude ENOENT`，
 * 导致所有 mac_web harness 任务卡死。因此检测到 /.dockerenv（容器）时，
 * 必须 **ssh 逃逸到宿主** 执行 claude（与 docker-executor 用 docker.sock 逃逸同理）。
 * 裸机直跑 brain（无 /.dockerenv）时保留原直接 spawn 逻辑。
 *
 * WORKSPACE_PATH env var：告知 evaluator SKILL 把 .brain-result.json 写到哪里
 * （Docker 默认 /workspace，host 执行时为 worktreePath）。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const HOST_PROMPT_DIR = process.env.CECELIA_HOST_PROMPT_DIR || '/tmp/cecelia-host-prompts';
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000; // 90 min

// 容器 → 宿主 ssh 逃逸默认配置（可被 env 覆盖）
const DEFAULT_HOST_SSH_TARGET = 'administrator@host.docker.internal';
const DEFAULT_HOST_SSH_KEYS = [
  '/Users/administrator/.ssh/id_ed25519',
  '/Users/administrator/.ssh/id_rsa',
];
// 宿主上 cecelia repo 根（容器内 import.meta.url 解析不出正确 repoRoot，故用固定宿主路径）
const DEFAULT_HOST_REPO = '/Users/administrator/perfect21/cecelia';

/** 单引号包裹做 shell 转义，安全拼进 ssh 远端命令字符串 */
function shq(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

/** 返回第一个存在的路径（用于自动发现宿主私钥） */
function firstExisting(paths) {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

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

  // Write prompt to file for debug/audit (same pattern as docker-executor).
  // 含运行实例唯一后缀，同一 taskId 重跑互不覆盖（forensics-no-overwrite-r2）。
  if (!existsSync(HOST_PROMPT_DIR)) mkdirSync(HOST_PROMPT_DIR, { recursive: true });
  const runInstance = randomBytes(4).toString('hex');
  writeFileSync(path.join(HOST_PROMPT_DIR, `${taskId}.${runInstance}-host.prompt`), opts.prompt, 'utf8');

  const spawnFn = opts.spawnFn || nodeSpawn;

  // 容器检测：brain 在 docker 容器内（/.dockerenv 存在）→ 必须 ssh 逃逸到宿主跑 claude。
  // opts.inContainer 可显式覆盖（测试用）。
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');

  // 注入给 claude 进程的 env（宿主执行时 BRAIN_URL 等由 caller 经 opts.env 给 localhost）
  const injectedEnv = {
    ...(opts.env || {}),
    WORKSPACE_PATH: worktreePath,
    CECELIA_TASK_ID: taskId,
    CECELIA_HEADLESS: 'true',
  };

  // 宿主上 claude-launch.sh 路径（固定宿主 repo 根，不依赖容器内 import.meta.url）
  const hostRepo = opts.hostRepoRoot || process.env.CECELIA_HOST_REPO || DEFAULT_HOST_REPO;
  const hostLauncher = path.join(hostRepo, 'scripts/claude-launch.sh');

  let cmdArgs;
  let spawnEnv;
  let launcherLabel;

  if (inContainer) {
    // ── 容器内：ssh 逃逸到宿主执行 ──────────────────────────────────────────
    const sshTarget = opts.hostSshTarget || process.env.CECELIA_HOST_EXEC_SSH || DEFAULT_HOST_SSH_TARGET;
    const sshKey = opts.hostSshKey || process.env.CECELIA_HOST_EXEC_SSH_KEY || firstExisting(DEFAULT_HOST_SSH_KEYS);

    // 远端命令：cd 到 worktree → 用 env 前缀注入变量 → 跑宿主 claude-launch.sh（读 stdin）
    const envPrefix = Object.entries(injectedEnv)
      .map(([k, v]) => `${k}=${shq(v)}`)
      .join(' ');
    // P1#4（2026-06-27 审计）：超时只 kill 本地 ssh 客户端**杀不掉宿主上的 claude**
    // （孤儿进程持续占 CPU/内存 + 持有 worktree git 锁，下轮撞锁）。让宿主侧 timeout 自行
    // 在 timeoutSec 后 SIGTERM、再 10s 后 SIGKILL，不依赖 ssh 客户端存活。timeout/gtimeout
    // 由 homebrew coreutils 提供（ssh 远端 PATH 含 /opt/homebrew/bin）；万一都没有则降级直接跑。
    const timeoutSec = Math.ceil(timeoutMs / 1000);
    const remoteCmd =
      'cd ' + shq(worktreePath) + ' && ' +
      'TB=$(command -v timeout || command -v gtimeout || true) && ' +
      'env ' + envPrefix + ' ${TB:+$TB -k 10 ' + timeoutSec + 's} ' +
      'bash ' + shq(hostLauncher) + ' --dangerously-skip-permissions -p';

    const sshArgs = [];
    if (sshKey) sshArgs.push('-i', sshKey);
    sshArgs.push(
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'BatchMode=yes',
      sshTarget,
      remoteCmd,
    );
    cmdArgs = ['ssh', ...sshArgs];
    // ssh 客户端进程自身只需 HOME/PATH 找 ssh 二进制；远端 env 由 remoteCmd 的 env 前缀负责
    spawnEnv = {
      HOME: process.env.HOME || '/Users/administrator',
      PATH: process.env.PATH || '/usr/bin:/bin',
      ...process.env,
    };
    launcherLabel = `ssh→${sshTarget}`;
  } else {
    // ── 裸机：直接在本机 spawn（legacy 路径）──────────────────────────────
    const useLocalLauncher = existsSync(hostLauncher);
    cmdArgs = useLocalLauncher
      ? ['bash', hostLauncher, '--dangerously-skip-permissions', '-p']
      : ['claude', '--dangerously-skip-permissions', '-p'];
    spawnEnv = {
      HOME: process.env.HOME || '/Users/administrator',
      PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      ...process.env,
      ...injectedEnv,
    };
    launcherLabel = useLocalLauncher ? 'claude-launch.sh' : 'claude';
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  console.log(`[host-executor] spawn task=${taskId} worktree=${worktreePath} mode=${inContainer ? 'container-ssh' : 'host-direct'} launcher=${launcherLabel}`);

  return new Promise((resolve) => {
    const proc = spawnFn(cmdArgs[0], cmdArgs.slice(1), {
      cwd: inContainer ? undefined : worktreePath,
      env: spawnEnv,
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
