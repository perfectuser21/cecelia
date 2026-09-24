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
const CODEX_ACCOUNT_DIRS = ['.codex-team1', '.codex-team2', '.codex-team3', '.codex-team4', '.codex-team5'];
// macOS 真实路径（/var 是 /private/var 的符号链接）；Linux 等无此链接的平台须经
// CECELIA_ORCHESTRATOR_RUNNER_ROOT 覆盖。
const DEFAULT_RUNNER_ROOT = '/private/var/lib/cecelia/runner-checkout';

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

// 凭据根 = OrbStack 属主 home（installer 渲染进 plist 的 CECELIA_ORBSTACK_HOME）。fleet-worker 以 _cecelia
// 运行，run.js 里的 loader 需要知道去哪读、以及该目录属主是谁（作为可信 uid）。
// 本函数只是存在性/可读性守卫：零账号可读时 fail-loud，免得 run 起来后才死在凭据读取上、白占槽位。
// 信任校验（属主/权限/父目录）由 run.js 的 loader 负责，这里不做。
function probeCredentialHome(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('credential_home_root_invalid');
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('credential_home_root_invalid');
  const readable = CODEX_ACCOUNT_DIRS.some((dir) => {
    try { fs.accessSync(path.join(root, dir, 'auth.json'), fs.constants.R_OK); return true; } catch { return false; }
  });
  if (!readable) throw new Error('credential_home_no_accounts');
  return { root, uid: stat.uid };
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
  probeCredentialHome: probeCredentialHomeFn = probeCredentialHome,
  existsFn = fs.existsSync,
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
        // 'preparing'（并发重放，不等待）或其它非终态一律视为冲突
        throw httpError('orchestrator_already_exists', 409);
      }
      if (active() >= maxConcurrent) throw httpError('orchestrator_slots_exhausted', 429);
      // 槽位预占（Fix 2）：检查通过后、任何 await 之前立刻登记占位状态，
      // 防止并发 prepare 在 await 窗口内一起挤过 active() 检查、共同抢占同一个槽位。
      const job = {
        runId, taskId: body.task_id, status: 'preparing',
        worktreePath: null, baseSha: null, pid: null, host: hostname, startedAt: null,
      };
      jobs.set(runId, job);
      try {
        const baseSha = SHA_RE.test(body?.base_sha ?? '') ? body.base_sha : await resolveMainSha(repo);
        // Fix 1：spec 形状对齐 workspace-manager.cjs 真实 validateSpec（SPEC_FIELDS 白名单
        // 严格拒绝未知字段，task_id 不进 spec；branch 必须匹配 BRANCH_PATTERN=cp-*；
        // expected_head_sha 必须显式 null；mode 必须 read-write，因为 kernel 会在 worktree
        // 里 ensureGitCommit 提交产物）。
        const spec = {
          repo,
          branch: `cp-orch-${runId.slice(0, 8)}`,
          base_sha: baseSha,
          expected_head_sha: null,
          mode: 'read-write',
          run_id: runId,
          attempt_id: runId,
        };
        const workspace = await workspaceManager.prepare(spec, { nodeDeps: true });
        job.worktreePath = workspace.path;
        job.baseSha = baseSha;
        job.status = 'prepared';
        return receipt(job, hostname);
      } catch (err) {
        jobs.delete(runId); // 预占失败，释放槽位
        throw err;
      }
    },

    async start(runId, body) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_prepared', 404);
      if (job.status === 'running') return receipt(job, hostname); // 幂等重放
      if (job.status !== 'prepared') throw httpError('orchestrator_not_startable', 409);
      const sessionId = body?.controller_session_id;
      const generation = Number(body?.controller_generation);
      if (!UUID_RE.test(sessionId ?? '') || !Number.isSafeInteger(generation) || generation < 1) {
        throw httpError('controller_lease_identity_missing', 400);
      }
      // 探测失败 = run 置 failed（终态，TERMINAL 自动释放槽位），同一 run 的 start/prepare 重放得 409。
      let credentialHome;
      try {
        credentialHome = probeCredentialHomeFn(env.CECELIA_ORBSTACK_HOME);
      } catch (err) {
        job.status = 'failed';
        const error = httpError('orchestrator_credential_home_unavailable', 500);
        error.cause = err;
        throw error;
      }
      const runnerRoot = env.CECELIA_ORCHESTRATOR_RUNNER_ROOT || DEFAULT_RUNNER_ROOT;
      // run.js 必须从 runner-checkout 的真实路径启动（不能经符号链接），否则 run.js 底部
      // import.meta.url === pathToFileURL(process.argv[1]).href 自检恒 false，main() 不执行。
      const runner = path.join(runnerRoot, 'packages/brain/src/orchestrator/run.js');
      if (!existsFn(runner)) {
        job.status = 'failed';
        throw httpError('orchestrator_runner_root_unavailable', 500);
      }
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
          // skills 根不能指向任务 worktree（REPO_ROOT），否则 loadSkillBundle 找不到 SKILL.md。
          CECELIA_SKILLS_ROOT: path.join(runnerRoot, 'packages/workflows/skills'),
          CECELIA_CREDENTIAL_HOME_ROOT: credentialHome.root,
          CECELIA_CREDENTIAL_TRUSTED_UIDS: String(credentialHome.uid),
          ...(logPath ? { CECELIA_KERNEL_LOG_PATH: logPath } : {}),
        },
      });
      // C2（终审）：detached spawn 的异步 ENOENT/EACCES 走 'error' 事件；不监听=
      // uncaughtException=整个 fleet-worker 进程崩（连坐 attempt 面）。必须在同步
      // pid 检查之前挂上，因为 error 事件也可能在下一个 tick 就到。
      child.once('error', (err) => {
        job.status = 'failed';
        console.error(`[orchestrator-runner] spawn_error run=${runId}: ${err?.message}`);
      });
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        job.status = 'failed'; // 终态释放槽位
        throw httpError('orchestrator_spawn_failed', 502);
      }
      // C1（终审）：orchestrator 槽位只借不还——进程退出即释放槽位，否则 active()
      // 恒占坑，第 3 个 prepare 起 orchestrator_slots_exhausted。detached+unref 下
      // exit 事件在父进程（fleet-worker）存活期间仍会送达。
      child.once('exit', (code) => {
        job.status = code === 0 ? 'done' : 'failed';
      });
      child.unref?.();
      job.pid = child.pid;
      job.status = 'running';
      job.startedAt = Date.now();
      return receipt(job, hostname);
    },

    async inspect(runId) {
      if (!UUID_RE.test(runId ?? '')) throw httpError('orchestrator_run_id_invalid', 400);
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      return receipt(job, hostname);
    },

    // 预留端点：当前无生产调用方（Brain 侧将来终态回执用）。槽位释放已由 start()
    // 里 spawn 后挂的 exit 钩子承担，本端点不再是槽位释放的唯一路径。
    async terminal(runId, body) {
      if (!UUID_RE.test(runId ?? '')) throw httpError('orchestrator_run_id_invalid', 400);
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      job.status = body?.outcome === 'failed' ? 'failed' : 'done';
      return receipt(job, hostname);
    },
  });
}

module.exports = { createOrchestratorRunner, probeCredentialHome };
