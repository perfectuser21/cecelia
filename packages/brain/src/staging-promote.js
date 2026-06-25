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

import { execSync } from 'child_process';
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
 */
export function defaultPromoteExec(repoRoot) {
  return function promoteExec() {
    const script = path.join(repoRoot, 'scripts/promote-dashboard.sh');
    try {
      const output = execSync(`bash ${script}`, { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
      return { ok: true, output };
    } catch (err) {
      return { ok: false, output: `${err.message}\n${err.stdout || ''}\n${err.stderr || ''}` };
    }
  };
}

export function getRepoRoot() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '../../..');
}
