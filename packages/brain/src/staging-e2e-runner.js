/**
 * staging-e2e-runner.js — Slice 1（阶段2：harness merge=终点 → 延长到 staging 真 E2E）
 *
 * 背景（spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 1）：
 * 旧 harness 在 merge 前用 evaluator 验 PR 分支/活宿主，验不出"合了但真环境坏"（silent-success）。
 * 本片在 sub_task 合并后，**独立于 langgraph（绝不碰 interrupt，见 memory harness-langgraph-interrupt-throw：
 * interrupt 等人会重新挂起死循环+容器泄漏）**，由 mergePrNode best-effort 建 task_type='staging_e2e'
 * Brain 任务；executor 同步执行本 runner：部署候选版本到 :5222 staging → 在**真 staging 实例**跑
 * contract E2E（按 Contract 硬断言）→ verdict 落 staging_e2e_results。
 *
 * 设计纪律：
 * - 纯逻辑（target 解析 / INSERT 构造 / verdict 归一 / 编排）与副作用（deploy/E2E/db）分离，
 *   副作用由 executor 注入 deps，单测无需 docker/db。
 * - 皇冠断言：E2E 目标必须是 staging:5222（STAGING_PORT），绝不能退回 5221 production 或 PR 分支活宿主，
 *   否则又退回 silent-success 老路。
 * - 复用现成件：scripts/staging-deploy.sh（部署）+ host-executor / evaluator 容器机制（E2E），禁建平行系统。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// staging 实例固定端口（production = 5221，staging = 5222；皇冠断言钉死此值）
export const STAGING_PORT = 5222;
export const STAGING_DB_NAME = 'cecelia_staging';

/**
 * 解析 staging E2E 的目标（皇冠断言核心）：必须指向 staging:5222 + cecelia_staging 库，
 * 不是活宿主/PR分支/production:5221。
 * @param {object} task  staging_e2e Brain 任务（payload 里有 pr_url/sprint_dir 等）
 * @returns {{ targetEnv:string, stagingPort:number, brainUrl:string, dbUrl:string }}
 */
export function resolveStagingTarget(_task) {
  return {
    targetEnv: 'staging',
    stagingPort: STAGING_PORT,
    brainUrl: `http://localhost:${STAGING_PORT}`,
    dbUrl: `postgresql://localhost/${STAGING_DB_NAME}`,
  };
}

/**
 * 归一化 E2E verdict → staging_e2e_results.verdict 取值（pass/fail/skipped）。
 * evaluator 协议 verdict 可能是 PASS/FAIL/FIXED；FIXED 视作 pass（功能已达成）。
 */
export function normalizeStagingVerdict(raw) {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'PASS' || v === 'FIXED') return 'pass';
  if (v === 'SKIPPED') return 'skipped';
  return 'fail';
}

/**
 * 构造 mergePrNode merge 成功后建 staging_e2e 任务的 INSERT（best-effort 副作用）。
 * DB 级幂等：tasks 表无 UNIQUE(pr_url)，用 WHERE NOT EXISTS 按 payload->>'pr_url' 去重，
 * 防 tick 重入（mergePrNode 因 BEHIND 重试 / "已被外部合并"幂等分支多次进入）重复建任务。
 *
 * @param {object} state  harness-task graph state（merge 成功后）
 * @returns {{ sql:string, params:any[] } | null}  无 pr_url → null（不建任务）
 */
export function buildStagingE2eTaskInsert(state) {
  const prUrl = state?.pr_url;
  if (!prUrl) return null;

  const task = state.task || {};
  const tpayload = task.payload || {};
  const payload = {
    pr_url: prUrl,
    pr_branch: state.pr_branch || '',
    sub_task_id: task.id || '',
    initiative_id: state.initiativeId || tpayload.initiative_id || '',
    sprint_dir: tpayload.sprint_dir || 'sprints',
    contract_branch: state.contractBranch || tpayload.contract_branch || '',
    journey_id: tpayload.journey_id || '',
    feature_id: tpayload.feature_id || '',
    feature_name: tpayload.feature_name || task.title || '',
  };

  const title = `[Staging E2E] ${task.title || prUrl}`;
  const description = `Auto-spawned by mergePrNode after merge of ${prUrl} (Slice 1: staging deploy + E2E)`;

  // WHERE NOT EXISTS 按 payload->>'pr_url' 去重（幂等）。pr_url 同时落 staging_e2e_results
  // 的 UNIQUE(pr_url) 做第二道 DB 级闸（migration 304）。
  const sql = `
    INSERT INTO tasks (title, description, task_type, status, priority, payload)
    SELECT $1, $2, 'staging_e2e', 'queued', 'P1', $3::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM tasks
      WHERE task_type = 'staging_e2e'
        AND payload->>'pr_url' = $4
    )`;
  return { sql, params: [title, description, JSON.stringify(payload), prUrl] };
}

/**
 * 构造 verdict 落 staging_e2e_results 的 INSERT（ON CONFLICT (pr_url) DO NOTHING 幂等）。
 */
export function buildVerdictInsert({ taskId, initiativeId, prUrl, prBranch, verdict, feedback, skipReason, targetEnv }) {
  const sql = `
    INSERT INTO staging_e2e_results
      (task_id, initiative_id, pr_url, pr_branch, verdict, feedback, staging_skip_reason, target_env, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
    ON CONFLICT (pr_url) DO NOTHING`;
  return {
    sql,
    params: [
      taskId || null,
      initiativeId || null,
      prUrl,
      prBranch || null,
      verdict,
      feedback || null,
      skipReason || null,
      targetEnv || null,
    ],
  };
}

/**
 * staging E2E 编排（Brain 内部 handler，同步执行，不派 agent、不碰 interrupt）。
 * 1. deployStaging → 部署候选版本到 :5222（复用 staging-deploy.sh）。skipReason → 优雅降级 verdict=skipped。
 * 2. runE2eOnStaging → 在真 staging 实例跑 contract E2E（target 由 resolveStagingTarget 钉到 :5222）。
 * 3. verdict 落 staging_e2e_results（ON CONFLICT DO NOTHING）。
 *
 * 全程不抛错：任何失败收敛成 verdict=fail/skipped 落库（本片只到 verdict 落库，不碰放行/report）。
 *
 * @param {object} task  staging_e2e Brain 任务
 * @param {object} deps  { deployStaging, runE2eOnStaging, dbQuery }
 * @returns {Promise<{ verdict:string, targetEnv:string }>}
 */
export async function runStagingE2e(task, deps) {
  const payload = task.payload || {};
  const prUrl = payload.pr_url;
  const target = resolveStagingTarget(task);

  let verdict = 'fail';
  let feedback = null;
  let skipReason = null;

  try {
    // ── 1. 部署 staging ──────────────────────────────────────────────────
    const dep = await deps.deployStaging(task, target);
    if (!dep.ok) {
      // staging 不可用（no_docker / no_env）→ 优雅降级，verdict=skipped（不阻断、不抛错）
      skipReason = dep.skipReason || 'deploy_failed';
      verdict = 'skipped';
      feedback = `staging deploy skipped: ${skipReason}`;
    } else {
      // ── 2. 在真 staging 实例跑 E2E（皇冠断言：target 指向 :5222）────────────
      const e2e = await deps.runE2eOnStaging({ task, ...target });
      verdict = normalizeStagingVerdict(e2e.verdict);
      feedback = e2e.feedback || null;
    }
  } catch (err) {
    verdict = 'fail';
    feedback = `staging e2e error: ${err.message}`.slice(0, 1000);
  }

  // ── 3. verdict 落库（ON CONFLICT DO NOTHING；本片只到落库）────────────────
  try {
    const ins = buildVerdictInsert({
      taskId: task.id,
      initiativeId: payload.initiative_id,
      prUrl,
      prBranch: payload.pr_branch,
      verdict,
      feedback,
      skipReason,
      targetEnv: target.targetEnv,
    });
    await deps.dbQuery(ins.sql, ins.params);
  } catch (err) {
    // 落库失败只告警，不抛（runner 不应让 dispatcher 回退 queued）
    console.warn(`[staging-e2e-runner] verdict insert failed pr=${prUrl}: ${err.message}`);
  }

  return { verdict, targetEnv: target.targetEnv };
}

/**
 * 默认 deployStaging 实现：spawn scripts/staging-deploy.sh，解析 STAGING_SKIP_REASON。
 * （executor 注入；单测用 mock 替换。）
 */
export function defaultDeployStaging(repoRoot) {
  return async function deployStaging() {
    const script = path.join(repoRoot, 'scripts/staging-deploy.sh');
    return await new Promise((resolve) => {
      const child = nodeSpawn('bash', [script], { cwd: repoRoot, env: process.env });
      let out = '';
      child.stdout?.on('data', (d) => { out += d.toString(); });
      child.stderr?.on('data', (d) => { out += d.toString(); });
      child.on('close', (code) => {
        const skipMatch = out.match(/STAGING_SKIP_REASON=(\S+)/);
        if (skipMatch) {
          resolve({ ok: false, skipReason: skipMatch[1] });
        } else if (code === 0) {
          resolve({ ok: true, skipReason: null });
        } else {
          resolve({ ok: false, skipReason: 'deploy_failed' });
        }
      });
      child.on('error', () => resolve({ ok: false, skipReason: 'deploy_failed' }));
    });
  };
}

/**
 * 默认 runE2eOnStaging 实现：复用 host-executor 在宿主跑 evaluator SKILL，
 * 但 env 钉到 staging:5222（皇冠断言）。读 .brain-result.json 取 verdict。
 * （executor 注入真实 executeOnHost + readAndValidateBrainResult；单测用 mock。）
 */
export function defaultRunE2eOnStaging({ executeOnHost, readBrainResult, worktreePath }) {
  return async function runE2eOnStaging(target) {
    const result = await executeOnHost({
      task: { id: target.task.id, task_type: 'staging_e2e' },
      prompt: `IS_FINAL_E2E=true\nTARGET_ENV=staging\n在 staging 实例（${target.brainUrl}）跑 contract E2E，按 Contract 硬断言验收。`,
      worktreePath,
      env: {
        IS_FINAL_E2E: 'true',
        TARGET_ENV: 'staging',
        BRAIN_URL: target.brainUrl,   // 皇冠断言：staging:5222
        DB: target.dbUrl,             // cecelia_staging
      },
    });
    if (!result || result.exit_code !== 0) {
      return { verdict: 'FAIL', feedback: `staging e2e exit_code=${result?.exit_code ?? 'unknown'}`, targetEnv: 'staging' };
    }
    const data = await readBrainResult(worktreePath);
    return { verdict: data?.verdict || 'FAIL', feedback: data?.feedback || null, targetEnv: 'staging' };
  };
}

// 默认导出文件路径解析（executor 用）
export function getRepoRoot() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '../../..');
}
