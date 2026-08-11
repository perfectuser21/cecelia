/**
 * diff-gate.js — Diff Impact Gate（FR-4）
 *
 * 编码后以真实 diff 重新查询影响半径，与合同对账，进行 drift 仲裁。
 *
 * 四类情形：
 *   pass    — 实际影响 ⊆ 声明影响（完全相等或减少）
 *   extend  — 新增节点且断言已覆盖（扩展合同后放行）
 *   drift   — 新增节点缺少断言 → CONTRACT_IMPACT_DRIFT
 *   blocked — Mapper 不可判定（unavailable/stale/revision mismatch）
 *
 * fail-closed 原则：Mapper 任何不可判定情形均返回 blocked，绝不假绿。
 *
 * sprint: 08110022-relay-d96c9fa0 ws4
 */

import { queryImpactRadius } from './map-client.js';
import { getActiveImpactContract, persistImpactContract } from './contract-store.js';
import {
  createRepairTaskForGap,
  openGapForDrift,
  transitionGapStatus,
} from './gap-store.js';
import { compareImpactContract } from './diff-compare.js';
export { compareImpactContract } from './diff-compare.js';

// ---------- 副作用操作 ----------

/**
 * recordDriftEvent(db, { taskId, contractId, addedNodes, addedAssertions }) — 写入 gap_events 表。
 *
 * @param {import('pg').Pool} db
 * @param {{ taskId: string, contractId?: string, addedNodes: string[], addedAssertions: string[] }} opts
 * @returns {Promise<object>}
 */
async function recordDriftGaps(db, {
  taskId,
  contractId,
  addedNodes,
  revision,
  actualNodes,
  repo,
}) {
  const gaps = [];
  const nodeById = new Map((actualNodes ?? []).map((node) => [
    node?.capability_id ?? node?.id ?? node,
    node,
  ]));
  for (const nodeId of addedNodes) {
    const node = nodeById.get(nodeId);
    const { gap } = await openGapForDrift(db, {
      sourceTaskId: taskId,
      impactNodeId: nodeId,
      owner: node?.owner ?? null,
      severity: node?.severity ?? 'medium',
      revision,
      idempotencyKey: `contract-drift:${contractId ?? 'none'}:${revision ?? 'none'}:${nodeId}`,
    });
    if (gap.owner) {
      await createRepairTaskForGap(db, gap, { repo });
      if (gap.status === 'open') {
        await transitionGapStatus(db, gap.id, 'assigned', {
          actor: gap.owner,
          idempotencyKey: `auto-assigned:${gap.id}`,
          detail: { source: 'impact_diff_gate' },
        });
      }
    }
    gaps.push(gap);
  }
  return gaps;
}

/**
 * blockTask(db, taskId) — 将任务状态更新为 blocked。
 *
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function blockTask(db, taskId) {
  await db.query(
    `UPDATE tasks
     SET status = 'blocked',
         blocked_at = COALESCE(blocked_at, NOW()),
         blocked_reason = 'contract_impact_drift',
         blocked_detail = jsonb_build_object('source', 'impact_diff_gate'),
         updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'canceled', 'failed')`,
    [taskId]
  );
}

async function recordDriftAndBlockTask(db, input) {
  const isPool = typeof db.connect === 'function' && db.constructor?.name !== 'Client';
  const client = isPool ? await db.connect() : db;
  try {
    if (isPool) await client.query('BEGIN');
    const gaps = await recordDriftGaps(client, input);
    await blockTask(client, input.taskId);
    if (isPool) await client.query('COMMIT');
    return gaps;
  } catch (error) {
    if (isPool) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (isPool) client.release();
  }
}

// ---------- 主函数 ----------

/**
 * evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles }) — 运行 Diff Impact Gate。
 *
 * 步骤：
 *   1. 读取 active impact contract
 *   2. 用 mapClient 复算影响半径（head revision）
 *   3. 校验 Mapper freshness 及 revision 对齐
 *   4. compareImpactContract 对账
 *   5. 根据裁决执行副作用（drift → 写 gap_events + block 任务）
 *   6. 返回 gate verdict
 *
 * @param {{
 *   db: import('pg').Pool,
 *   taskId: string,
 *   mapClient?: Function,        // 可注入 mock（供测试使用）
 *   headRevision?: string,       // HEAD commit
 *   changedFiles?: string[],     // 本次变更文件列表
 *   repo?: string,               // 仓库标识
 * }} params
 * @returns {Promise<{
 *   gate: 'pass'|'extend'|'drift'|'blocked'|'impact_unknown',
 *   verdict?: 'pass'|'extend'|'drift',
 *   reason?: string,
 *   reason_code?: string|null,
 *   added_nodes?: string[],
 *   removed_nodes?: string[],
 *   added_assertions?: string[],
 *   contract?: object|null,
 *   gap_event?: object|null,
 *   retryable?: boolean,
 * }>}
 */
export async function evaluateDiffGate({
  db,
  taskId,
  mapClient,
  headRevision,
  changedFiles = [],
  repo,
  persistContract = persistImpactContract,
} = {}) {
  // --- 步骤 1：读取 active contract ---
  let contract = null;
  if (db) {
    try {
      contract = await getActiveImpactContract(db, taskId);
    } catch {
      // DB 不可达时 fail-closed
      return {
        gate: 'impact_unknown',
        reason: 'db_unavailable',
        retryable: true,
      };
    }
    if (!contract) {
      return {
        gate: 'impact_unknown',
        reason: 'contract_missing',
        retryable: false,
      };
    }
  }

  // --- 步骤 2：调用 Mapper 复算影响半径 ---
  const mapperFn = mapClient || queryImpactRadius;

  let mapperResult;
  try {
    mapperResult = await mapperFn({
      repo: repo || contract?.repo,
      baseRevision: contract?.base_revision,
      headRevision,
      changedFiles,
      manifestDigest: contract?.manifest_digest,
      projectionDigest: contract?.projection_digest,
    });
  } catch {
    // Mapper 不可达 → fail-closed，返回 impact_unknown（不进入 pass/extend/drift 裁决）
    return {
      gate: 'impact_unknown',
      reason: 'mapper_unavailable',
      retryable: true,
    };
  }

  // --- 步骤 3：校验 Mapper 可判定性 ---

  // 3a. Mapper stale（freshness.status !== 'fresh'）→ impact_unknown
  if (!mapperResult?.freshness || mapperResult.freshness.status !== 'fresh') {
    return {
      gate: 'impact_unknown',
      reason: 'mapper_stale',
      retryable: true,
    };
  }

  // 3b. revision mismatch（事实投影必须与合同 base revision 对齐）→ impact_unknown
  const expectedFactRevision = contract?.base_revision;
  if (expectedFactRevision) {
    const repoKey = repo || contract?.repo || Object.keys(mapperResult.fact_revisions ?? {})[0];
    if (!repoKey || mapperResult.fact_revisions?.[repoKey] === undefined) {
      return {
        gate: 'impact_unknown',
        reason: 'revision_evidence_missing',
        retryable: true,
      };
    }
    const mapperRevision = mapperResult.fact_revisions[repoKey];
    if (mapperRevision !== expectedFactRevision) {
      return {
        gate: 'impact_unknown',
        reason: 'revision_mismatch',
        retryable: true,
      };
    }
  }
  if (contract?.manifest_digest && mapperResult.manifest_digest !== contract.manifest_digest) {
    return { gate: 'impact_unknown', reason: 'manifest_digest_mismatch', retryable: true };
  }
  if (contract?.projection_digest && mapperResult.projection_digest !== contract.projection_digest) {
    return { gate: 'impact_unknown', reason: 'projection_digest_mismatch', retryable: true };
  }

  // --- 步骤 4：对账 ---
  const contractNodes = contract?.contract_body?.affected_capabilities ?? [];
  const contractAssertions = contract?.contract_body?.required_assertions ?? [];
  const actualNodes = mapperResult.affected_nodes ?? [];
  const actualAssertions = mapperResult.required_assertions ?? [];

  const comparison = compareImpactContract(contractNodes, actualNodes, contractAssertions, actualAssertions);

  // --- 步骤 5：执行副作用 ---
  let gapEvent = null;

  if (comparison.verdict === 'extend' && db) {
    const toCapability = (node) => (
      typeof node === 'string' ? { capability_id: node } : node
    );
    const priorBody = contract.contract_body || {};
    const extendedBody = {
      ...priorBody,
      affected_capabilities: (mapperResult.affected_nodes || []).map(toCapability),
      required_assertions: mapperResult.required_assertions || [],
      manifest_digest: mapperResult.manifest_digest,
      projection_digest: mapperResult.projection_digest,
      fact_revisions: mapperResult.fact_revisions,
      freshness_evidence: mapperResult.freshness,
    };
    try {
      const persisted = await persistContract(db, {
        task_id: taskId,
        change_kind: contract.change_kind,
        repo: repo || contract.repo || null,
        base_revision: contract.base_revision,
        head_revision: headRevision || null,
        manifest_digest: mapperResult.manifest_digest,
        projection_digest: mapperResult.projection_digest,
        contract_body: extendedBody,
      });
      contract = persisted.contract;
    } catch {
      return {
        gate: 'impact_unknown',
        reason: 'contract_extend_write_failed',
        retryable: true,
      };
    }
  }

  if (comparison.verdict === 'drift' && db) {
    try {
      const gaps = await recordDriftAndBlockTask(db, {
        taskId,
        contractId: contract?.id ?? null,
        addedNodes: comparison.drift_nodes?.length
          ? comparison.drift_nodes
          : comparison.added_nodes,
        actualNodes: mapperResult.affected_nodes,
        repo: repo || contract?.repo,
        revision: headRevision,
      });
      gapEvent = gaps[0] ?? null;
    } catch {
      return {
        gate: 'impact_unknown',
        reason: 'gap_ledger_write_failed',
        retryable: true,
      };
    }
  }

  // --- 步骤 6：返回裁决 ---
  const gate = comparison.verdict === 'drift' ? 'drift' : comparison.verdict;

  return {
    gate,
    verdict: comparison.verdict,
    reason_code: comparison.reason_code,
    added_nodes: comparison.added_nodes,
    removed_nodes: comparison.removed_nodes,
    added_assertions: comparison.added_assertions,
    changed_assertions: comparison.changed_assertions,
    removed_assertions: comparison.removed_assertions,
    required_assertions: contract?.contract_body?.required_assertions ?? [],
    contract: contract ?? null,
    gap_event: gapEvent,
    retryable: false,
  };
}

export default {
  compareImpactContract,
  evaluateDiffGate,
};
