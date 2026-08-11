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

// ---------- 对账逻辑 ----------

/**
 * extractNodeIds(nodes) — 从节点列表提取 capability_id 集合。
 *
 * @param {any[]} nodes
 * @returns {Set<string>}
 */
function extractNodeIds(nodes) {
  const ids = new Set();
  if (!Array.isArray(nodes)) return ids;
  for (const node of nodes) {
    const id = node?.capability_id ?? node?.id ?? node;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * extractAssertionIds(assertions) — 从断言列表提取 assertion_id 集合。
 *
 * @param {any[]} assertions
 * @returns {Set<string>}
 */
function extractAssertionIds(assertions) {
  const ids = new Set();
  if (!Array.isArray(assertions)) return ids;
  for (const a of assertions) {
    const id = a?.assertion_id ?? a?.id ?? a;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

function extractRunnableAssertionCoverage(assertions) {
  const coveredCapabilityIds = new Set();
  if (!Array.isArray(assertions)) return coveredCapabilityIds;
  for (const assertion of assertions) {
    if (
      assertion
      && typeof assertion === 'object'
      && typeof assertion.assertion_id === 'string'
      && assertion.assertion_id
      && typeof assertion.command === 'string'
      && assertion.command.trim()
    ) {
      for (const capabilityId of assertion.covers_capability_ids ?? []) {
        if (typeof capabilityId === 'string' && capabilityId) {
          coveredCapabilityIds.add(capabilityId);
        }
      }
    }
  }
  return coveredCapabilityIds;
}

/**
 * compareImpactContract(contractNodes, actualNodes, contractAssertions, actualAssertions) — 核心对账函数。
 *
 * @param {any[]} contractNodes      合同声明的 affected_capabilities 节点列表
 * @param {any[]} actualNodes        Mapper 返回的实际影响节点列表
 * @param {any[]} contractAssertions 合同声明的 required_assertions
 * @param {any[]} actualAssertions   Mapper 返回的 required_assertions
 * @returns {{
 *   verdict: 'pass'|'extend'|'drift',
 *   added_nodes: string[],
 *   removed_nodes: string[],
 *   added_assertions: string[],
 *   reason_code: null|'CONTRACT_IMPACT_DRIFT',
 * }}
 */
export function compareImpactContract(contractNodes, actualNodes, contractAssertions = [], actualAssertions = []) {
  const contractIds = extractNodeIds(contractNodes);
  const actualIds = extractNodeIds(actualNodes);
  const contractAssertionIds = extractAssertionIds(contractAssertions);
  const actualAssertionIds = extractAssertionIds(actualAssertions);
  const runnableAssertionCoverage = new Set([
    ...extractRunnableAssertionCoverage(contractAssertions),
    ...extractRunnableAssertionCoverage(actualAssertions),
  ]);

  // 计算新增节点（实际 - 合同）
  const addedNodes = [];
  for (const id of actualIds) {
    if (!contractIds.has(id)) addedNodes.push(id);
  }

  // 计算减少节点（合同 - 实际）
  const removedNodes = [];
  for (const id of contractIds) {
    if (!actualIds.has(id)) removedNodes.push(id);
  }

  // 计算新增断言（实际 - 合同）
  const addedAssertions = [];
  for (const id of actualAssertionIds) {
    if (!contractAssertionIds.has(id)) addedAssertions.push(id);
  }

  // 情形一：无新增节点 → pass（影响减少或相等）
  // 影响减少时保留原断言，不删除，仅记录 removed_nodes 作为差异证据
  if (addedNodes.length === 0) {
    return {
      verdict: 'pass',
      added_nodes: [],
      removed_nodes: removedNodes,
      added_assertions: [],
      reason_code: null,
    };
  }

  // 情形二/三：有新增节点
  // 断言名称不是能力覆盖证据。新增节点必须由可执行断言显式声明 covers_capability_ids。
  const allNewNodesCovered = addedNodes.every((nodeId) => runnableAssertionCoverage.has(nodeId));

  if (allNewNodesCovered) {
    // 情形二：新增影响有对应断言 → extend
    return {
      verdict: 'extend',
      added_nodes: addedNodes,
      removed_nodes: removedNodes,
      added_assertions: addedAssertions,
      reason_code: null,
    };
  }

  // 情形三：新增影响缺少断言 → drift
  return {
    verdict: 'drift',
    added_nodes: addedNodes,
    removed_nodes: removedNodes,
    added_assertions: addedAssertions,
    reason_code: 'CONTRACT_IMPACT_DRIFT',
  };
}

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

  // 3b. revision mismatch（fact_revisions 与 headRevision 不对齐）→ impact_unknown
  if (headRevision) {
    const repoKey = repo || contract?.repo || Object.keys(mapperResult.fact_revisions ?? {})[0];
    if (!repoKey || mapperResult.fact_revisions?.[repoKey] === undefined) {
      return {
        gate: 'impact_unknown',
        reason: 'revision_evidence_missing',
        retryable: true,
      };
    }
    const mapperRevision = mapperResult.fact_revisions[repoKey];
    if (mapperRevision !== headRevision) {
      return {
        gate: 'impact_unknown',
        reason: 'revision_mismatch',
        retryable: true,
      };
    }
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
        addedNodes: comparison.added_nodes,
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
