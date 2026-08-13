/**
 * F1 Capability 可重复认证读回（Mapper fail-closed 聚合）
 *
 * Sprint: F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）
 *
 * 复用现有 Mapper 语义（不新增平行认证系统）：
 *   - 沿用 map/state-resolver.js 的 state / reason_code 枚举与聚合规则
 *     （aggregateCapabilityState 在本模块用于把单个 F1 节点态收敛为 capability 结论）
 *   - green 结论必须由「当前 revision 的非 synthetic PASS receipt」支撑
 *     （journey_assertion_receipts，DB CHECK 已强制 synthetic=false）
 *   - fail-closed：冻结身份/合同/Feature/receipt/merge SHA 任一不齐 → not green
 *
 * 判定顺序（fail-closed，越前置越硬）：
 *   1. 冻结 GP Contract 身份不匹配 signed 合同        → gray  / contract_identity_mismatch
 *   2. 缺 Feature 绑定（journey_step_link.feature_id）  → gray  / anchor_target_missing
 *   3. 无 receipt                                       → gray  / no_receipt（补证据，非缺陷）
 *   4. receipt verdict=FAIL                             → red   / receipt_fail（缺陷）
 *   5. PASS 但缺/错 expected_merge_sha（validation clock）→ unknown / revision_mismatch
 *   6. PASS 且 source_sha == expected_merge_sha         → green / pass_current_revision
 */

import pool from '../db.js';
import { aggregateCapabilityState } from './state-resolver.js';

/**
 * 纯决策函数：给定已取回的事实，产出 { state, reason_code }。
 * 无 IO、无副作用，便于穷举分支单测。
 *
 * @param {object} facts
 * @param {boolean} facts.contractMatch  - 冻结身份命中 signed golden_path_contract_versions
 * @param {boolean} facts.featureBound   - 存在 journey_step_link 且 feature_id 非空
 * @param {{ verdict: string, source_sha: string|null }|null} facts.receipt
 *        - 该 cell 上最近一条非 synthetic receipt（无则 null）
 * @param {string|null} facts.expectedMergeSha - validation clock 锚点
 * @returns {{ state: 'green'|'red'|'gray'|'unknown', reason_code: string }}
 */
export function decideF1State({ contractMatch, featureBound, receipt, expectedMergeSha }) {
  if (!contractMatch) {
    return { state: 'gray', reason_code: 'contract_identity_mismatch' };
  }
  if (!featureBound) {
    return { state: 'gray', reason_code: 'anchor_target_missing' };
  }
  if (!receipt) {
    return { state: 'gray', reason_code: 'no_receipt' };
  }
  if (receipt.verdict === 'FAIL') {
    return { state: 'red', reason_code: 'receipt_fail' };
  }
  // verdict === 'PASS'（DB CHECK 保证 PASS 时 synthetic=false + source_sha 40hex）
  if (!expectedMergeSha || receipt.source_sha !== expectedMergeSha) {
    // 缺 clock 锚点或 SHA 不一致 → 拒绝共享 validation clock
    return { state: 'unknown', reason_code: 'revision_mismatch' };
  }
  return { state: 'green', reason_code: 'pass_current_revision' };
}

/**
 * 读回 F1 认证结论（真库读路径，禁 mock 被改的边）。
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} params
 * @returns {Promise<object>} certification 响应对象（见 contract Response Schema）
 */
export async function resolveF1Certification(db, {
  capability,
  gp_contract_id,
  gp_contract_version,
  gp_contract_hash,
  journey_id,
  step_id,
  expected_merge_sha = null,
}) {
  // 1. 冻结身份 → signed 合同（真查 content_hash + status）
  const contractRes = await db.query(
    `SELECT id FROM golden_path_contract_versions
     WHERE id = $1 AND version = $2 AND content_hash = $3 AND status = 'signed'
     LIMIT 1`,
    [gp_contract_id, gp_contract_version, gp_contract_hash]
  );
  const contractMatch = contractRes.rows.length > 0;

  // 2. Feature 绑定：F1 cell（journey_step_link.feature_id 非空）
  let cell = null;
  if (contractMatch) {
    const cellRes = await db.query(
      `SELECT id FROM journey_step_links
       WHERE journey_id = $1 AND step_id = $2
         AND feature_id IS NOT NULL AND assertion_ref IS NOT NULL
       ORDER BY (cell_kind = 'capability') DESC NULLS LAST, created_at ASC
       LIMIT 1`,
      [journey_id, step_id]
    );
    cell = cellRes.rows[0] || null;
  }
  const featureBound = Boolean(cell);

  // 3. 该 cell 上最近一条非 synthetic receipt
  let receipt = null;
  if (featureBound) {
    const recRes = await db.query(
      `SELECT id, verdict, source_sha
       FROM journey_assertion_receipts
       WHERE journey_step_link_id = $1 AND gp_contract_id = $2
         AND gp_contract_hash = $3 AND synthetic = false
       ORDER BY created_at DESC, completed_at DESC
       LIMIT 1`,
      [cell.id, gp_contract_id, gp_contract_hash]
    );
    receipt = recRes.rows[0] || null;
  }

  const decision = decideF1State({
    contractMatch,
    featureBound,
    receipt,
    expectedMergeSha: expected_merge_sha || null,
  });

  // 复用 Mapper 聚合规则收敛单节点 → capability 结论（禁平行系统）
  const state = aggregateCapabilityState([{ state: decision.state }]);
  const isGreen = state === 'green';

  return {
    capability,
    state,
    gp_contract_id,
    gp_contract_version: Number(gp_contract_version),
    gp_contract_hash,
    journey_id,
    step_id,
    receipt_id: isGreen && receipt ? receipt.id : null,
    synthetic: false,
    merge_sha: isGreen && receipt ? receipt.source_sha : null,
    reason_code: decision.reason_code,
  };
}

/**
 * 便捷入口：用默认连接池读回（HTTP handler 用）。
 * @param {object} params
 */
export function resolveF1CertificationWithPool(params) {
  return resolveF1Certification(pool, params);
}
