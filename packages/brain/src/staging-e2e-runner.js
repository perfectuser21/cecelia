/**
 * Staging E2E Runner（阶段2 Slice1）。
 *
 * harness sub_task 合并后，reportNode 派生一个 task_type='staging_e2e' 的 Brain 任务。
 * 本模块是该任务的 native 执行器（executor.triggerCeceliaRun 直接调用，
 * 独立于 langgraph / interrupt）：
 *   1. 复用 scripts/staging-deploy.sh 把 Brain 部署到 :5222；
 *   2. 加载 initiative_contracts.e2e_acceptance，在真 staging 实例上跑 contract E2E；
 *   3. verdict（PASS/FAIL/SKIP）落 staging_e2e_results 表，并写回 tasks.result。
 *
 * 不碰人工放行 / promote / report（Slice2/3）。
 *
 * verdict 语义：
 *   PASS  — 部署成功且全部 scenario 通过
 *   FAIL  — 部署失败 / scenario 失败 / 合同结构非法
 *   SKIP  — staging 是"加分项"：无 docker / 无 .env.staging / 无合同 时跳过（非失败）
 */

import { execSync } from 'child_process';
import pool from './db.js';
import { updateTaskStatus } from './task-updater.js';
import { normalizeAcceptance } from './harness-final-e2e.js';

export const STAGING_PORT = 5222;
const DEFAULT_DEPLOY_SCRIPT = 'scripts/staging-deploy.sh';
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const SCENARIO_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CAP_BYTES = 4000;

function cap(s) {
  const str = typeof s === 'string' ? s : (s ? String(s) : '');
  return str.length > OUTPUT_CAP_BYTES ? str.slice(-OUTPUT_CAP_BYTES) : str;
}

/**
 * 跑 scripts/staging-deploy.sh，返回机器可读结果。
 * staging-deploy.sh 优雅降级时打印 STAGING_SKIP_REASON=no_docker/no_env，
 * 此处解析为 status='skipped'，不算失败。
 *
 * @returns {{status:'success'|'skipped'|'failed', reason:string|null, output:string}}
 */
export function deployStaging(opts = {}) {
  const exec = opts.exec || execSync;
  const script = opts.deployScript || DEFAULT_DEPLOY_SCRIPT;
  try {
    const raw = exec(`bash ${script}`, {
      encoding: 'utf8',
      cwd: opts.cwd,
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
    const out = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    const skip = out.match(/STAGING_SKIP_REASON=(\S+)/);
    if (skip) return { status: 'skipped', reason: skip[1], output: cap(out) };
    return { status: 'success', reason: null, output: cap(out) };
  } catch (err) {
    const combined = `${err.stdout ? String(err.stdout) : ''}\n${err.stderr ? String(err.stderr) : ''}\n${err.message || ''}`.trim();
    // 脚本即便非 0 退出也可能已打印 skip 原因（如 setup 失败）→ 仍视为 skip 而非 fail
    const skip = combined.match(/STAGING_SKIP_REASON=(\S+)/);
    if (skip) return { status: 'skipped', reason: skip[1], output: cap(combined) };
    return { status: 'failed', reason: 'deploy_failed', output: cap(combined) };
  }
}

/**
 * 跑一条 contract scenario 命令，针对 staging :5222。
 *
 * 与 harness-final-e2e.runScenarioCommand 的差异：staging E2E 验证的是 Brain 自身，
 * 命令合法地访问 :5222 的 /api/brain/*，因此不套 planner_drift 拦截；并把命令里的
 * :5221 重写到 :5222，使针对 production 端口写的合同也能打到 staging 实例。
 *
 * @returns {{exitCode:number, output:string}}
 */
export function runStagingCommand(command, opts = {}) {
  const exec = opts.exec || execSync;
  const port = opts.port || STAGING_PORT;
  if (!command || typeof command.cmd !== 'string' || !command.cmd.trim()) {
    return { exitCode: 1, output: '(empty cmd)' };
  }
  const cmd = command.cmd
    .replace(/localhost:5221/g, `localhost:${port}`)
    .replace(/127\.0\.0\.1:5221/g, `127.0.0.1:${port}`);
  try {
    const raw = exec(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      timeout: SCENARIO_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
    const str = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    return { exitCode: 0, output: cap(str) };
  } catch (err) {
    const combined = `${err.stdout ? String(err.stdout) : ''}\n${err.stderr ? String(err.stderr) : ''}\n${err.message || ''}`.trim();
    return { exitCode: Number.isInteger(err.status) ? err.status : 1, output: cap(combined) };
  }
}

/**
 * 顺序跑 e2e_acceptance 全部 scenario（scenario 内命令 fail-fast）。
 * @returns {{verdict:'PASS'|'FAIL', scenariosTotal:number, scenariosPassed:number, failedScenarios:Array}}
 */
export function runScenarios(acceptance, opts = {}) {
  const { scenarios } = normalizeAcceptance(acceptance);
  const failedScenarios = [];
  let scenariosPassed = 0;
  for (const sc of scenarios) {
    let failure = null;
    for (const command of sc.commands) {
      const r = runStagingCommand(command, opts);
      if (r.exitCode !== 0) {
        failure = { name: sc.name, exitCode: r.exitCode, output: r.output };
        break;
      }
    }
    if (failure) failedScenarios.push(failure);
    else scenariosPassed++;
  }
  return {
    verdict: failedScenarios.length === 0 ? 'PASS' : 'FAIL',
    scenariosTotal: scenarios.length,
    scenariosPassed,
    failedScenarios,
  };
}

/** 加载该 initiative 的合同 e2e_acceptance（优先 approved，否则最新 version）。 */
async function loadE2eAcceptance(dbPool, initiativeId) {
  const q = await dbPool.query(
    `SELECT e2e_acceptance FROM initiative_contracts
     WHERE initiative_id::text = $1
     ORDER BY (CASE WHEN status = 'approved' THEN 0 ELSE 1 END), version DESC
     LIMIT 1`,
    [initiativeId]
  );
  return q.rows[0]?.e2e_acceptance || null;
}

/** verdict 落 staging_e2e_results 表。 */
async function recordResult(dbPool, r) {
  // Slice1 修正：pr_url UNIQUE（migration 305）→ ON CONFLICT DO NOTHING 做 DB 级幂等，
  // 防同一 pr_url 重复落 verdict（per-merge 重入时不抛错、不覆盖既有 verdict）。
  await dbPool.query(
    `INSERT INTO staging_e2e_results
       (task_id, initiative_id, pr_url, verdict, reason, staging_port,
        scenarios_total, scenarios_passed, failed_scenarios, deploy_output, deployed_at, tested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (pr_url) DO NOTHING`,
    [
      r.taskId, r.initiativeId, r.prUrl, r.verdict, r.reason, r.port,
      r.scenariosTotal || 0, r.scenariosPassed || 0,
      JSON.stringify(r.failedScenarios || []),
      r.deployOutput || null, r.deployedAt || null, r.testedAt || null,
    ]
  );
}

/** 把 verdict 摘要写回 tasks.result（SSOT 仍是 staging_e2e_results）。 */
async function writeTaskResult(dbPool, taskId, resultObj) {
  await dbPool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
     WHERE id = $1::uuid`,
    [taskId, JSON.stringify({ staging_e2e: resultObj })]
  );
}

/**
 * staging_e2e 任务 native 执行器。executor.triggerCeceliaRun 直接调用。
 *
 * 返回约定与其它 executor 分支一致：{ success:true, taskId, ... } 表示"executor 已处理完毕，
 * dispatcher 无需回退 queued"。仅当基础设施异常（DB 写失败等）才标 task failed。
 *
 * @param {{id:string, payload?:object}} task
 * @param {{pool?, deploy?, loadAcceptance?, exec?, cwd?}} [opts]
 */
export async function runStagingE2E(task, opts = {}) {
  const dbPool = opts.pool || pool;
  const deploy = opts.deploy || deployStaging;
  const loadAcceptance = opts.loadAcceptance || loadE2eAcceptance;
  const p = task.payload || {};
  const initiativeId = p.initiative_id || p.initiativeId || null;
  const prUrl = p.pr_url || (Array.isArray(p.pr_urls) ? p.pr_urls[0] : null) || null;

  const base = {
    taskId: task.id, initiativeId, prUrl, port: STAGING_PORT,
    scenariosTotal: 0, scenariosPassed: 0, failedScenarios: [],
    deployOutput: null, deployedAt: null, testedAt: null,
  };

  // 终局：落库 + 写回 tasks.result + 标 completed
  const finalize = async (verdict, reason, extra = {}) => {
    await recordResult(dbPool, { ...base, ...extra, verdict, reason });
    await writeTaskResult(dbPool, task.id, {
      verdict, reason,
      scenarios_total: extra.scenariosTotal ?? base.scenariosTotal,
      scenarios_passed: extra.scenariosPassed ?? base.scenariosPassed,
      pr_url: prUrl, initiative_id: initiativeId,
    });
    await updateTaskStatus(task.id, 'completed');
    return { success: true, taskId: task.id, verdict, reason };
  };

  try {
    if (!initiativeId) return await finalize('SKIP', 'no_initiative_id');

    // 1. 先加载合同（无合同则连 deploy 都不必跑）
    const acceptance = await loadAcceptance(dbPool, initiativeId);
    if (!acceptance) return await finalize('SKIP', 'no_contract');

    // 2. 部署 staging :5222
    const dep = deploy({ exec: opts.exec, cwd: opts.cwd });
    base.deployOutput = dep.output;
    if (dep.status === 'skipped') return await finalize('SKIP', dep.reason);
    if (dep.status === 'failed') return await finalize('FAIL', 'deploy_failed');
    base.deployedAt = new Date();

    // 3. 在真 staging 实例跑 contract E2E
    let run;
    try {
      run = runScenarios(acceptance, { exec: opts.exec, cwd: opts.cwd, port: STAGING_PORT });
    } catch (err) {
      base.testedAt = new Date();
      return await finalize('FAIL', `invalid_contract: ${String(err.message).slice(0, 160)}`);
    }
    base.testedAt = new Date();

    return await finalize(run.verdict, run.verdict === 'PASS' ? null : 'scenarios_failed', {
      scenariosTotal: run.scenariosTotal,
      scenariosPassed: run.scenariosPassed,
      failedScenarios: run.failedScenarios,
    });
  } catch (err) {
    // 基础设施异常（DB 写失败等）→ task failed，让 dispatcher/重试机制处理
    console.error(`[staging-e2e] runStagingE2E error task=${task.id}: ${err.message}`);
    try {
      await updateTaskStatus(task.id, 'failed', { error_message: String(err.message).slice(0, 500) });
    } catch { /* best-effort */ }
    return { success: true, taskId: task.id, failed: true, error: String(err.message).slice(0, 500) };
  }
}
