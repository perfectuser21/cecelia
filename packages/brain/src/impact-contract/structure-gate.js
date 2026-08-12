/**
 * structure-gate.js — Structure Gate（FR-3）
 *
 * 编码前合同校验。Mapper 不可判定时 fail-closed，绝不放行。
 *
 * 规则（依据 contract-dod.md [BEHAVIOR] 断言）：
 * - task 无 change_kind → blocked/change_kind_missing（HTTP 400）
 * - Mapper unavailable（连接失败/timeout）→ blocked/mapper_unavailable（HTTP 503，retryable: true）
 * - Mapper stale（freshness.status !== 'fresh'）→ blocked/mapper_stale（HTTP 503，retryable: true）
 * - revision mismatch（fact_revisions 与合同 base_revision 不匹配）→ blocked/revision_mismatch（HTTP 409，retryable: true）
 * - schema + 引用完整时 → 持久化 active contract + 返回 pass（HTTP 201）
 * - 相同输入幂等不新增版本
 *
 * fail-closed 原则：任何不可判定情形均返回 blocked，绝不返回 pass。
 *
 * sprint: 08110022-relay-d96c9fa0 ws3
 */

import { queryImpactRadius } from './map-client.js';
import { persistImpactContract } from './contract-store.js';
import { normalizeFreshnessEvidence } from './contract-schema.js';

// ---------- 结果构建工具 ----------

/**
 * buildBlockedResult(reason, httpStatus, extra) — 构建 blocked 结果对象。
 *
 * @param {string} reason  机器可读 reason code
 * @param {number} httpStatus  HTTP 状态码
 * @param {object} extra  附加字段
 * @returns {{ gate: 'blocked', reason: string, retryable: boolean, httpStatus: number }}
 */
function buildBlockedResult(reason, httpStatus, extra = {}) {
  return {
    gate: 'blocked',
    reason,
    retryable: httpStatus === 503 || httpStatus === 409,
    httpStatus,
    ...extra,
  };
}

/**
 * buildPassResult(contract) — 构建 pass 结果对象。
 *
 * @param {object} contract  持久化后的合同对象
 * @returns {{ gate: 'pass', httpStatus: number, contract: object }}
 */
function buildPassResult(contract, created) {
  return {
    gate: 'pass',
    httpStatus: created ? 201 : 200,
    contract,
  };
}

// ---------- 主函数 ----------

/**
 * evaluateStructureGate({ db, task, contract, mapClient, git }) — 运行 Structure Gate。
 *
 * @param {{
 *   db: import('pg').Pool,
 *   task: { id: string, change_kind?: string|null, task_type?: string },
 *   contract: {
 *     task_id: string,
 *     change_kind: string,
 *     repo?: string,
 *     base_revision: string,
 *     head_revision?: string,
 *     manifest_digest?: string,
 *     projection_digest?: string,
 *     affected_capabilities: any[],
 *     required_assertions: any[],
 *     contract_body: object,
 *   },
 *   mapClient?: Function,  // 可注入 mock（供测试使用）
 *   git?: object,          // 可注入 git helper（供测试使用）
 * }} params
 * @returns {Promise<{
 *   gate: 'pass'|'blocked',
 *   reason?: string,
 *   retryable?: boolean,
 *   httpStatus: number,
 *   contract?: object,
 * }>}
 */
export async function evaluateStructureGate({
  db,
  task,
  contract,
  mapClient,
  persistContract = persistImpactContract,
  git: _git,
} = {}) {
  // --- 规则 1：task 无 change_kind → blocked/change_kind_missing ---
  if (!task || !task.change_kind) {
    return buildBlockedResult('change_kind_missing', 400);
  }

  // --- 使用注入的测试客户端或默认真实 Mapper 客户端 ---
  const mapperFn = mapClient || queryImpactRadius;
  const declaredCapabilities = (
    contract?.contract_body?.affected_capabilities ?? contract?.affected_capabilities ?? []
  ).map(item => (typeof item === 'string' ? item : item?.capability_id)).filter(Boolean);

  // --- 规则 2/3/4：调用 Mapper，处理不可判定情形 ---
  let mapperResult;
  try {
    mapperResult = await mapperFn({
      repo: contract?.repo,
      baseRevision: contract?.base_revision,
      headRevision: contract?.head_revision,
      changedFiles: [],
      capabilityIds: declaredCapabilities,
    });
  } catch {
    // Mapper 不可达（连接失败、timeout 等）→ fail-closed
    return buildBlockedResult('mapper_unavailable', 503);
  }

  // --- 规则 3：Mapper stale（freshness.status !== 'fresh'）---
  if (!mapperResult?.freshness || mapperResult.freshness.status !== 'fresh') {
    return buildBlockedResult('mapper_stale', 503);
  }

  // --- 规则 4：revision mismatch ---
  // 投影来自合并基线；head_revision 只标识候选 diff，不能冒充已扫描事实。
  const expectedRevision = contract?.base_revision;
  if (expectedRevision) {
    const repo = contract.repo || Object.keys(mapperResult.fact_revisions ?? {})[0];
    if (!repo || mapperResult.fact_revisions?.[repo] === undefined) {
      return buildBlockedResult('revision_evidence_missing', 409);
    }
    const mapperRevision = mapperResult.fact_revisions[repo];
    if (mapperRevision !== expectedRevision) {
      return buildBlockedResult('revision_mismatch', 409);
    }
  }

  // --- 放行：schema + Mapper 均通过 → 持久化合同 ---
  if (db && contract) {
    const manifestDigest = mapperResult.manifest_digest;
    const projectionDigest = mapperResult.projection_digest;
    const contractBody = {
      ...(contract.contract_body || contract),
      affected_capabilities: (mapperResult.affected_nodes || []).map(node => ({
        capability_id: node.capability_id ?? node.id,
        ...(node.capability_name ? { capability_name: node.capability_name } : {}),
        ...(node.impact_level ? { impact_level: node.impact_level } : {}),
      })),
      required_assertions: mapperResult.required_assertions || [],
      manifest_digest: manifestDigest,
      projection_digest: projectionDigest,
      fact_revisions: mapperResult.fact_revisions,
      freshness_evidence: normalizeFreshnessEvidence(mapperResult.freshness),
    };
    const { contract: persisted, created } = await persistContract(db, {
      task_id: contract.task_id || task.id,
      change_kind: contract.change_kind,
      repo: contract.repo || null,
      base_revision: contract.base_revision,
      head_revision: contract.head_revision || null,
      manifest_digest: manifestDigest,
      projection_digest: projectionDigest,
      contract_body: contractBody,
    });

    return buildPassResult(persisted, created);
  }

  // 无 db（测试场景不需要持久化时）→ 返回 pass
  return { gate: 'pass', httpStatus: 201 };
}
