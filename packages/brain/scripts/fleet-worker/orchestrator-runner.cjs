'use strict';
/**
 * orchestrator-runner.cjs — kernel orchestrator 的 worker 侧生命周期（决策 2e756506）。
 *
 * 与 attempt-runner 的分工：attempt = 短周期终端执行体（docker 容器）；
 * orchestrator = 长周期编排进程（宿主裸进程），它内部还会派 attempt 给本机 worker。
 * 槽位必须独立（判定点 854888a0）：共用池会自锁——orchestrator 占满槽位后，
 * 它要派的 attempt 永远拿不到槽位，互相等死。
 *
 * 为什么裸进程不进容器：orchestrator 要回连本机 5231 派 attempt、要直连 us-vps
 * postgres（决策 a9773a84）、要读宿主 provider 账号目录——容器化需为这三条各开
 * 通道且无先例；宿主上它们全是现成的。
 */
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const execFileAsync = promisify(execFile);

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const TERMINAL = new Set(['done', 'failed']);

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function receipt(job, hostname) {
  return {
    orchestrator_id: job.runId,
    status: job.status,
    worktree_path: job.worktreePath,
    base_sha: job.baseSha,
    pid: job.pid,
    host: hostname,
  };
}

function createOrchestratorRunner({
  workspaceManager,
  dataRoot,
  hostname,
  maxConcurrent = 2,
  spawnFn = spawn,
  mkdirFn = (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }),
  openFn = (p) => fs.openSync(p, 'a'),
  resolveMainShaFn = null,
  repoSourceFor = (repo) => `https://github.com/${repo}.git`,
  env = process.env,
} = {}) {
  if (!workspaceManager || typeof workspaceManager.prepare !== 'function') {
    throw new Error('orchestrator_runner_workspace_manager_required');
  }
  const jobs = new Map(); // run_id → {status, worktreePath, taskId, pid, startedAt}
  const active = () => [...jobs.values()].filter((j) => !TERMINAL.has(j.status)).length;

  const resolveMainSha = resolveMainShaFn ?? (async (repo) => {
    const { stdout } = await execFileAsync(
      'git', ['ls-remote', repoSourceFor(repo), 'refs/heads/main'],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const sha = String(stdout).split(/\s/)[0];
    if (!SHA_RE.test(sha)) throw httpError('orchestrator_main_sha_unresolvable', 502);
    return sha;
  });

  return Object.freeze({
    async prepare(body) {
      const runId = body?.run_id;
      if (!UUID_RE.test(runId ?? '')) throw httpError('orchestrator_run_id_invalid', 400);
      if (!UUID_RE.test(body?.task_id ?? '')) throw httpError('orchestrator_task_id_invalid', 400);
      const repo = body?.repo ?? 'perfectuser21/cecelia';
      const existing = jobs.get(runId);
      if (existing) {
        if (existing.status === 'prepared') return receipt(existing, hostname); // 幂等重放
        throw httpError('orchestrator_already_exists', 409);
      }
      if (active() >= maxConcurrent) throw httpError('orchestrator_slots_exhausted', 429);
      const baseSha = SHA_RE.test(body?.base_sha ?? '') ? body.base_sha : await resolveMainSha(repo);
      const workspace = await workspaceManager.prepare(
        { repo, branch: 'main', base_sha: baseSha, attempt_id: runId, run_id: runId },
        { nodeDeps: true },
      );
      const job = {
        runId, taskId: body.task_id, status: 'prepared',
        worktreePath: workspace.path, baseSha, pid: null, host: hostname, startedAt: null,
      };
      jobs.set(runId, job);
      return receipt(job, hostname);
    },

    async start(runId, body) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_prepared', 404);
      if (job.status === 'running') return receipt(job, hostname); // 幂等重放
      if (job.status !== 'prepared') throw httpError(`orchestrator_not_startable:${job.status}`, 409);
      const sessionId = body?.controller_session_id;
      const generation = Number(body?.controller_generation);
      if (!UUID_RE.test(sessionId ?? '') || !Number.isSafeInteger(generation) || generation < 1) {
        throw httpError('controller_lease_identity_missing', 400);
      }
      const runner = path.join(job.worktreePath, 'packages/brain/src/orchestrator/run.js');
      const logDir = path.join(dataRoot, 'orchestrator-logs');
      let stdio = 'ignore';
      let logPath = null;
      try { // 刀0 同款：零遗言不可接受，日志落盘失败不阻断 spawn
        mkdirFn(logDir);
        logPath = path.join(logDir, `kernel-${runId}.log`);
        const fd = openFn(logPath);
        stdio = ['ignore', fd, fd];
      } catch { /* stdio 保持 ignore */ }
      const child = spawnFn(process.execPath, [
        runner,
        '--task-id', job.taskId,
        '--run-id', runId,
        '--controller-session-id', sessionId,
        '--controller-generation', String(generation),
      ], {
        cwd: job.worktreePath,
        detached: true,
        stdio,
        env: {
          ...env,
          CECELIA_HARNESS_RUNTIME: 'kernel-v1',
          REPO_ROOT: job.worktreePath,
          ...(logPath ? { CECELIA_KERNEL_LOG_PATH: logPath } : {}),
        },
      });
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        throw httpError('orchestrator_spawn_failed', 502);
      }
      child.unref?.();
      job.pid = child.pid;
      job.status = 'running';
      job.startedAt = Date.now();
      return receipt(job, hostname);
    },

    async inspect(runId) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      return receipt(job, hostname);
    },

    async terminal(runId, body) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      job.status = body?.outcome === 'failed' ? 'failed' : 'done';
      return receipt(job, hostname);
    },
  });
}

module.exports = { createOrchestratorRunner };
