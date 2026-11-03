'use strict';
/** Kernel新运行已退役；仅保留历史inspect/terminal与识别辅助。 */
const fs = require('node:fs');
const path = require('node:path');

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CODEX_ACCOUNT_DIRS = ['.codex-team1', '.codex-team2', '.codex-team3', '.codex-team4', '.codex-team5'];
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
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('orbstack_home_invalid');
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('orbstack_home_invalid');
  const readable = CODEX_ACCOUNT_DIRS.some((dir) => {
    try { fs.accessSync(path.join(root, dir, 'auth.json'), fs.constants.R_OK); return true; } catch { return false; }
  });
  if (!readable) throw new Error('credential_home_no_accounts');
  return { root, uid: stat.uid };
}

function createOrchestratorRunner({hostname} = {}) {
  const liveChildren = new Set();
  const jobs = new Map(); // run_id → {status, worktreePath, taskId, pid, startedAt}
  return Object.freeze({
    maintenance(){return {preparing:[...jobs.values()].filter(j=>j.status==='preparing').length,prepared:[...jobs.values()].filter(j=>j.status==='prepared').length,running_processes:liveChildren.size};},
    async prepare(_body) { throw httpError('kernel_runtime_retired', 410); },
    async start(_runId, _body) { throw httpError('kernel_runtime_retired', 410); },

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
