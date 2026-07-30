/**
 * staging-promote.js — Slice 2（阶段2：staging E2E PASS 后人工放行闸 + production promote）
 *
 * spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 2
 * 建立在 Slice 1 的 staging_e2e verdict 之上：
 * - 内部线（base_repo=cecelia）：PASS → 自动 promote（in-repo scripts/promote-dashboard.sh）。
 * - 客户线（base_repo=zenithjoy）：PASS → pending_promote + 飞书通知主理人，挂起等 confirm
 *   （回流接口 POST /api/brain/harness/promote/:resultId）。真打 zenithjoy 生产留 zenithjoy repo 放行闸，
 *   Cecelia 不跨 repo 伸手（决策1：跨 repo 边界）。
 * - base_repo 缺失 → 保守 pending（决策2：不误自动上线）。
 *
 * 纪律：
 * - pending = DB 状态行（staging_e2e_results.promote_status），**不碰 langgraph interrupt**，无进程挂等。
 * - 内部线 auto-promote 的真实脚本执行通过注入的 promoteExec 完成；测试必须 mock，绝不打真 :5211 live / 真 HK。
 * - promote 幂等：状态机 + 回流接口校验当前态。
 */

import { execFileSync } from 'child_process';
import { readFileSync as fsReadFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// promote_status 状态机取值
export const PROMOTE_STATUS = {
  PENDING_PROMOTE: 'pending_promote', // 客户线等主理人 confirm
  PROMOTING: 'promoting',             // 回流接口已接受，promote 进行中
  PROMOTED: 'promoted',               // promote 成功
  AUTO_PROMOTED: 'auto_promoted',     // 内部线自动 promote 成功（终态）
  PROMOTE_FAILED: 'promote_failed',   // promote 失败
  NA: 'n_a',                          // verdict≠PASS，不进 promote
};

// Slice3：harness_report 三态（决策 B）
// success = promote 完成的成功交付证书；failure = FAIL/SKIP/promote_failed 的失败报告；
// pending_promote 不出 report（靠 Slice2 通知+状态可见，等最终走向 promoted 或失败再出）。
export const REPORT_KIND = { SUCCESS: 'success', FAILURE: 'failure' };

/**
 * Slice3：构造派 harness_report 任务的 INSERT。
 * 幂等：按 initiative_id NOT EXISTS 去重（promote 完成点 / reportNode 失败路径都可能调，且可重入）。
 * payload 补全 staging E2E 结果 + 放行人/时间 + production 版本 + 回档锚点（决策 B 内容补全）。
 * @returns {{sql:string, params:any[]}|null}  无 initiativeId → null
 */
export function buildHarnessReportInsert(args = {}) {
  const initiativeId = args.initiativeId;
  if (!initiativeId) return null;
  const payload = {
    script_path: 'packages/brain/scripts/harness-report.mjs',
    initiative_id: initiativeId,
    report_kind: args.reportKind || REPORT_KIND.SUCCESS,
    // Slice1/2 已落库数据
    final_e2e_verdict: args.stagingE2eVerdict || null,
    staging_e2e_verdict: args.stagingE2eVerdict || null,
    promote_status: args.promoteStatus || null,
    promoted_at: args.promotedAt || null,
    promoted_by: args.promotedBy || null,
    production_version: args.productionVersion || null,
    rollback_anchor: args.rollbackAnchor || null,
    // Kernel equivalence closure: bind a green report task to the
    // server-verified effect evidence that authorized it.
    effect_receipt_id: args.effectReceiptId || null,
    effect_receipt_sha256: args.effectReceiptSha256 || null,
    effect_artifact_sha: args.effectArtifactSha || null,
    effect_evidence_verified_at:
      args.effectEvidenceVerifiedAt || null,
    // 沿用原 report 字段
    sprint_dir: args.sprintDir || null,
    journey_id: args.journeyId || null,
    feature_id: args.featureId || null,
    feature_name: args.featureName || args.title || '',
    pr_url: args.prUrl || '',
    pr_urls: args.prUrls || (args.prUrl ? [args.prUrl] : []),
    sub_tasks: args.subTasks || [],
    gan_rounds: args.ganRounds || 0,
    gan_cost_usd: args.ganCostUsd || 0,
  };
  const title = `[Harness Report] ${args.title || initiativeId}`;
  const description = `Auto-spawned (${payload.report_kind}) after ${payload.promote_status || payload.final_e2e_verdict} for initiative ${initiativeId}`;
  // 幂等：同 initiative 已有 harness_report 则不再派（promote 完成点 / 失败路径只出一份）
  const sql = `
    INSERT INTO tasks (title, description, task_type, status, priority, payload)
    SELECT $1, $2, 'harness_report', 'queued', 'P2', $3::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM tasks WHERE task_type = 'harness_report' AND payload->>'initiative_id' = $4
    )`;
  return { sql, params: [title, description, JSON.stringify(payload), String(initiativeId)] };
}

/**
 * Slice3：best-effort 派 harness_report（永不 throw）。
 * @param {{dbQuery:Function}} deps
 * @param {object} args  同 buildHarnessReportInsert
 * @returns {Promise<{spawned:boolean}>}
 */
export async function spawnHarnessReport(deps, args = {}) {
  try {
    const ins = buildHarnessReportInsert(args);
    if (!ins) return { spawned: false };
    await deps.dbQuery(ins.sql, ins.params);
    return { spawned: true };
  } catch (err) {
    console.warn(`[staging-promote] spawnHarnessReport failed (best-effort): ${err.message}`);
    return { spawned: false };
  }
}

/**
 * 按 base_repo 判客户线 vs 内部线。
 * @param {string} baseRepo
 * @returns {'customer'|'internal'|'unknown'}
 */
export function resolveLine(baseRepo) {
  const r = String(baseRepo || '').toLowerCase();
  if (!r) return 'unknown';
  if (r.includes('zenithjoy')) return 'customer';
  if (r.includes('cecelia')) return 'internal';
  return 'unknown';
}

/**
 * PASS 后放行决策。
 * @param {{verdict:string, baseRepo:string}} o
 * @returns {{action:'none'|'auto'|'pending', promoteStatus:string, line:string}}
 */
export function decidePromote({ verdict, baseRepo }) {
  if (verdict !== 'PASS') {
    return { action: 'none', promoteStatus: PROMOTE_STATUS.NA, line: resolveLine(baseRepo) };
  }
  const line = resolveLine(baseRepo);
  if (line === 'internal') {
    return { action: 'auto', promoteStatus: PROMOTE_STATUS.AUTO_PROMOTED, line };
  }
  // 客户线 + unknown（base_repo 缺失，决策2 保守）→ 挂 pending，不自动 promote
  return { action: 'pending', promoteStatus: PROMOTE_STATUS.PENDING_PROMOTE, line };
}

/**
 * 内部线自动 promote。**必须注入 promoteExec**；无注入则 fail-safe 拒绝
 * （防测试/误调误打真生产 :5211 live）。
 * @param {{promoteExec?:Function}} deps  promoteExec() → { ok:boolean, output:string }
 * @returns {Promise<{ok:boolean, promoteStatus:string, output:string}>}
 */
export async function runInternalPromote(deps = {}) {
  const promoteExec = deps.promoteExec;
  if (typeof promoteExec !== 'function') {
    return {
      ok: false,
      promoteStatus: PROMOTE_STATUS.PROMOTE_FAILED,
      output: 'no promoteExec injected (fail-safe: refuse to touch production)',
    };
  }
  try {
    const r = await promoteExec();
    return {
      ok: !!r?.ok,
      promoteStatus: r?.ok ? PROMOTE_STATUS.PROMOTED : PROMOTE_STATUS.PROMOTE_FAILED,
      output: String(r?.output || '').slice(0, 2000),
    };
  } catch (err) {
    return { ok: false, promoteStatus: PROMOTE_STATUS.PROMOTE_FAILED, output: `promote error: ${err.message}` };
  }
}

/**
 * 生产用默认 promoteExec：跑 in-repo scripts/promote-dashboard.sh（内部线 Cecelia dashboard）。
 * 仅由生产调用方注入；测试绝不用此实现。
 *
 * 防自杀：注入 CECELIA_SKIP_BRAIN_PROMOTE=1。promote-dashboard.sh 默认会跑 brain-deploy
 * 重启 Brain 容器，而 harness promote 正在该 Brain 容器内执行——不跳过会把执行它自己的
 * Brain 重启掉，pipeline 自杀。内部线只推 dashboard，无需重建 brain。
 */
export function defaultPromoteExec(repoRoot) {
  return function promoteExec() {
    const script = path.join(repoRoot, 'scripts/promote-dashboard.sh');
    try {
      const output = execFileSync('bash', [script], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CECELIA_SKIP_BRAIN_PROMOTE: '1' },
      });
      return { ok: true, output };
    } catch (err) {
      return { ok: false, output: `${err.message}\n${err.stdout || ''}\n${err.stderr || ''}` };
    }
  };
}

export function getRepoRoot() {
  // P1#3（2026-06-27 审计）：Brain 跑在 docker 容器时文件在 /app/src/，
  // path.resolve(import.meta.url, '../../..') 解析成 '/' → promote 脚本/回档锚点路径全错。
  // 容器 bind-mount 的 repo 根由 env REPO_ROOT 提供 → 优先用它；裸机直跑（无 REPO_ROOT）回退相对解析。
  // 一处修好所有 caller（含 routes/harness.js 的 /promote 放行接口此前裸调的两处）。
  if (process.env.REPO_ROOT) return process.env.REPO_ROOT;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '../../..');
}

/**
 * Slice3：读 production 版本 + 回档锚点（复用现有件，不新建）。
 * - production_version：`.brain-versions` 末行（brain-deploy 写的当前生产版本）。
 * - rollback_anchor：`.production-release` 的 manifest=<tag> 行（rollback-cecelia 账本锚点）。
 * 读不到 → null（best-effort，不阻断 report）。
 * @param {string} repoRoot
 * @param {{readFileSync?:Function}} [deps]  测试可注入
 */
export function readProductionInfo(repoRoot, deps = {}) {
  const readFileSync = deps.readFileSync || fsReadFileSync;
  let productionVersion = null;
  let rollbackAnchor = null;
  try {
    const bv = readFileSync(path.join(repoRoot, '.brain-versions'), 'utf8').trim().split('\n').filter(Boolean);
    productionVersion = bv.length ? bv[bv.length - 1].trim() : null;
  } catch { /* best-effort */ }
  try {
    const pr = readFileSync(path.join(repoRoot, '.production-release'), 'utf8');
    const m = pr.match(/manifest=(\S+)/);
    rollbackAnchor = m ? m[1] : null;
  } catch { /* best-effort */ }
  return { productionVersion, rollbackAnchor };
}
