/**
 * harness-staging-e2e.js — 阶段2 Slice1：merge 后 staging 部署 + 自动 E2E（verdict 落库）
 *
 * 闭环边界：
 *   harness sub_task PR 合并（runSubTaskNode 内 final.status==='merged'）
 *     → createStagingE2eTask() 在 tasks 表创建一个 task_type=staging_e2e 任务
 *       （独立于 langgraph：不是 graph 节点、不碰 interrupt/checkpoint）
 *     → staging-e2e-plugin tick 内联 claim 该任务 → handleStagingE2e()：
 *         1. 复用 scripts/staging-deploy.sh 把 Brain 部署到 :5222
 *         2. 在真 staging 实例跑 contract（initiative_contracts.e2e_acceptance）E2E
 *         3. verdict（PASS/FAIL/SKIP/ERROR）落 staging_e2e_results 表
 *
 * 本 Slice 不碰人工放行 / promote / report（Slice2/3）。
 *
 * 关键约束：
 *   - 全程 try-catch，任何异常都降级为 ERROR verdict + 落库，绝不向上抛错让 tick 崩溃。
 *   - staging-deploy.sh 优雅降级（no_docker / no_env）→ verdict=SKIP，不当失败处理。
 */
import { execFile as execFileCb } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFinalE2E } from './harness-final-e2e.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/brain/src → 仓库根
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const STAGING_DEPLOY_SCRIPT = path.join('scripts', 'staging-deploy.sh');

export const STAGING_PORT = 5222;
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000; // staging 部署最多 10 分钟（含 60s 健康检查轮询）

/**
 * 复用 scripts/staging-deploy.sh 把 Brain 部署到 :5222。
 *
 * 解析脚本约定的机器可读信号：
 *   - "Staging Deploy SUCCESS" → status='success'
 *   - "STAGING_SKIP_REASON=<reason>" → status='skipped'（no_docker / no_env，优雅降级）
 *   - 非 0 退出且无 skip 信号 → status='failed'
 *
 * @param {object} [opts]
 * @param {Function} [opts.execFile] child_process.execFile 替换（测试注入）
 * @param {string}   [opts.cwd]      仓库根（默认 REPO_ROOT）
 * @returns {Promise<{status:'success'|'skipped'|'failed', skipReason:string|null, exitCode:number, output:string}>}
 */
export function runStagingDeploy(opts = {}) {
  const execFn = opts.execFile || execFileCb;
  const cwd = opts.cwd || REPO_ROOT;
  return new Promise((resolve) => {
    execFn(
      'bash',
      [STAGING_DEPLOY_SCRIPT],
      { cwd, timeout: DEPLOY_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`.trim();
        const skipMatch = output.match(/STAGING_SKIP_REASON=([a-z_]+)/);
        if (skipMatch) {
          resolve({ status: 'skipped', skipReason: skipMatch[1], exitCode: 0, output });
          return;
        }
        if (!err && /Staging Deploy SUCCESS/.test(output)) {
          resolve({ status: 'success', skipReason: null, exitCode: 0, output });
          return;
        }
        const exitCode = err && Number.isInteger(err.code) ? err.code : (err ? 1 : 0);
        resolve({ status: 'failed', skipReason: null, exitCode, output });
      }
    );
  });
}

/**
 * 读取 initiative 的 contract E2E 验收（initiative_contracts.e2e_acceptance）。
 * 优先 approved，其次最高 version。无合同返回 null。
 *
 * @param {object} pool - pg pool
 * @param {string} initiativeId
 * @returns {Promise<object|null>} e2e_acceptance JSONB 或 null
 */
export async function loadContractAcceptance(pool, initiativeId) {
  const { rows } = await pool.query(
    `SELECT e2e_acceptance
       FROM initiative_contracts
      WHERE initiative_id = $1::uuid
      ORDER BY (status = 'approved') DESC, version DESC
      LIMIT 1`,
    [initiativeId]
  );
  return rows[0]?.e2e_acceptance || null;
}

/**
 * 在 tasks 表创建一个 staging_e2e 任务（带防重）。
 *
 * 防重键：同一 (initiative_id, sub_task_id) 已有未结束（queued/in_progress/pending）的
 * staging_e2e 任务则跳过 —— 保证 langgraph 节点重放（checkpoint replay）幂等。
 *
 * @param {object} pool - pg pool
 * @param {object} info
 * @param {string} info.initiativeId
 * @param {string} [info.subTaskId]
 * @param {string} [info.prUrl]
 * @param {string} [info.journeyId]
 * @returns {Promise<{created:boolean, taskId?:string, reason?:string}>}
 */
export async function createStagingE2eTask(pool, info = {}) {
  const { initiativeId, subTaskId = null, prUrl = null, journeyId = null } = info;
  if (!initiativeId) {
    return { created: false, reason: 'initiativeId required' };
  }

  // 防重：同 initiative + sub_task 已有未结束 staging_e2e 任务则跳过
  const dedup = await pool.query(
    `SELECT id FROM tasks
      WHERE task_type = 'staging_e2e'
        AND payload->>'initiative_id' = $1
        AND COALESCE(payload->>'sub_task_id', '') = COALESCE($2, '')
        AND status IN ('queued', 'in_progress', 'pending')
      LIMIT 1`,
    [initiativeId, subTaskId]
  );
  if (dedup.rows.length > 0) {
    return { created: false, reason: `dedup: 已有任务 ${dedup.rows[0].id}` };
  }

  const title = `[Staging E2E] ${initiativeId}${subTaskId ? ` · ${subTaskId}` : ''}`;
  const description = [
    `Harness sub_task PR 合并后，在真 staging 实例（:${STAGING_PORT}）跑 contract E2E。`,
    `- Initiative: ${initiativeId}`,
    subTaskId ? `- Sub task: ${subTaskId}` : '',
    prUrl ? `- PR: ${prUrl}` : '',
  ].filter(Boolean).join('\n');

  const result = await pool.query(
    `INSERT INTO tasks (title, description, status, priority, task_type, trigger_source, domain, payload)
     VALUES ($1, $2, 'queued', 'P1', 'staging_e2e', 'brain_auto', 'agent_ops', $3)
     RETURNING id`,
    [
      title,
      description,
      JSON.stringify({
        initiative_id: initiativeId,
        sub_task_id: subTaskId,
        pr_url: prUrl,
        journey_id: journeyId,
        created_at: new Date().toISOString(),
      }),
    ]
  );
  const taskId = result.rows[0]?.id;
  console.log(`[harness-staging-e2e] 创建 staging_e2e 任务: ${title} (id: ${taskId})`);
  return { created: true, taskId };
}

/**
 * verdict 落 staging_e2e_results 表。
 *
 * @param {object} pool
 * @param {object} row
 * @returns {Promise<string|null>} 新行 id
 */
export async function persistStagingE2eResult(pool, row) {
  const {
    initiativeId, subTaskId = null, taskId = null, verdict,
    deployStatus = null, skipReason = null, prUrl = null,
    failedScenarios = [], passedScenarios = [], detail = null,
  } = row;
  const { rows } = await pool.query(
    `INSERT INTO staging_e2e_results (
       initiative_id, sub_task_id, task_id, verdict, deploy_status, skip_reason,
       staging_port, pr_url, failed_scenarios, passed_scenarios, detail
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
     RETURNING id`,
    [
      initiativeId, subTaskId, taskId, verdict, deployStatus, skipReason,
      STAGING_PORT, prUrl,
      JSON.stringify(failedScenarios || []),
      JSON.stringify(passedScenarios || []),
      detail ? JSON.stringify(detail) : null,
    ]
  );
  return rows[0]?.id || null;
}

/**
 * 处理 staging_e2e 任务：staging 部署 → contract E2E → verdict 落库。
 *
 * verdict 语义：
 *   - SKIP  ：staging 部署被优雅降级跳过（no_docker/no_env）或合同缺失（无 e2e_acceptance）
 *   - FAIL  ：部署失败，或 contract E2E 至少一个 scenario 失败
 *   - PASS  ：staging 部署成功 + 所有 scenario 通过
 *   - ERROR ：处理过程异常（兜底，绝不向上抛）
 *
 * 不修改 task.status —— 由调用方（staging-e2e-plugin）负责 claim / 标记终态。
 *
 * @param {object} task - Brain task（id / payload）
 * @param {object} deps
 * @param {object}   deps.pool          - pg pool（必填）
 * @param {Function} [deps.runDeploy]   - 部署函数（默认 runStagingDeploy）
 * @param {Function} [deps.runE2E]      - E2E 函数（默认 runFinalE2E）
 * @param {Function} [deps.loadContract]- 合同加载（默认 loadContractAcceptance）
 * @param {Function} [deps.persist]     - 落库函数（默认 persistStagingE2eResult）
 * @returns {Promise<{verdict:string, deployStatus:string|null, skipReason:string|null, resultId:string|null}>}
 */
export async function handleStagingE2e(task, deps = {}) {
  const pool = deps.pool;
  const runDeploy = deps.runDeploy || runStagingDeploy;
  const runE2E = deps.runE2E || runFinalE2E;
  const loadContract = deps.loadContract || loadContractAcceptance;
  const persist = deps.persist || persistStagingE2eResult;

  const payload = task?.payload || {};
  const initiativeId = payload.initiative_id || payload.initiativeId;
  const subTaskId = payload.sub_task_id || payload.subTaskId || null;
  const prUrl = payload.pr_url || payload.prUrl || null;

  const base = { initiativeId, subTaskId, taskId: task?.id || null, prUrl };

  try {
    if (!initiativeId) {
      const resultId = await persist(pool, {
        ...base, verdict: 'ERROR', skipReason: 'no_initiative_id',
      });
      return { verdict: 'ERROR', deployStatus: null, skipReason: 'no_initiative_id', resultId };
    }

    // 1. 先确认有合同 E2E 验收，没有就别白部署
    const acceptance = await loadContract(pool, initiativeId);
    if (!acceptance) {
      const resultId = await persist(pool, {
        ...base, verdict: 'SKIP', deployStatus: 'skipped', skipReason: 'no_contract',
      });
      console.warn(`[harness-staging-e2e] initiative=${initiativeId} 无 e2e_acceptance 合同 → SKIP`);
      return { verdict: 'SKIP', deployStatus: 'skipped', skipReason: 'no_contract', resultId };
    }

    // 2. 复用 staging-deploy.sh 部署 :5222
    const deploy = await runDeploy();
    if (deploy.status === 'skipped') {
      const resultId = await persist(pool, {
        ...base, verdict: 'SKIP', deployStatus: 'skipped', skipReason: deploy.skipReason,
        detail: { deploy: { output: tail(deploy.output) } },
      });
      console.warn(`[harness-staging-e2e] staging 部署跳过（${deploy.skipReason}）→ SKIP`);
      return { verdict: 'SKIP', deployStatus: 'skipped', skipReason: deploy.skipReason, resultId };
    }
    if (deploy.status === 'failed') {
      const resultId = await persist(pool, {
        ...base, verdict: 'FAIL', deployStatus: 'failed', skipReason: 'deploy_failed',
        failedScenarios: [{ name: 'staging deploy failure', failedCommand: 'bash scripts/staging-deploy.sh', exitCode: deploy.exitCode, output: tail(deploy.output) }],
        detail: { deploy: { exitCode: deploy.exitCode, output: tail(deploy.output) } },
      });
      console.error(`[harness-staging-e2e] staging 部署失败（exit=${deploy.exitCode}）→ FAIL`);
      return { verdict: 'FAIL', deployStatus: 'failed', skipReason: 'deploy_failed', resultId };
    }

    // 3. 在真 staging 实例跑 contract E2E（部署已就绪 → skipBootstrap）
    const e2e = await runE2E(initiativeId, { e2e_acceptance: acceptance }, { skipBootstrap: true });
    const resultId = await persist(pool, {
      ...base,
      verdict: e2e.verdict,
      deployStatus: 'success',
      failedScenarios: e2e.failedScenarios || [],
      passedScenarios: e2e.passedScenarios || [],
      detail: { deploy: { output: tail(deploy.output) }, e2e },
    });
    console.log(`[harness-staging-e2e] initiative=${initiativeId} staging E2E verdict=${e2e.verdict}`);
    return { verdict: e2e.verdict, deployStatus: 'success', skipReason: null, resultId };
  } catch (err) {
    // 兜底：任何异常都降级为 ERROR + 落库，绝不向上抛
    console.error(`[harness-staging-e2e] handleStagingE2e 异常 → ERROR: ${err.message}\n${err.stack || ''}`);
    let resultId = null;
    try {
      resultId = await persist(pool, {
        ...base, verdict: 'ERROR', skipReason: 'exception',
        detail: { error: { message: err.message, stack: err.stack } },
      });
    } catch (persistErr) {
      console.error(`[harness-staging-e2e] ERROR verdict 落库也失败: ${persistErr.message}`);
    }
    return { verdict: 'ERROR', deployStatus: null, skipReason: 'exception', resultId };
  }
}

// 输出截断，避免 detail JSONB 过大
function tail(str, n = 4000) {
  if (!str || typeof str !== 'string') return str || '';
  return str.length > n ? str.slice(-n) : str;
}
