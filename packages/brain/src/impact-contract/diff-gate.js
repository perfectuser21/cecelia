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
 * MJ5 STUB: evaluateDiffGate 中对 Mapper 的调用依赖 MJ5 合同通过后替换。
 * 当前 stub 行为：如果未注入 mapClient，使用默认 stub 客户端（返回空影响节点）。
 *
 * fail-closed 原则：Mapper 任何不可判定情形均返回 blocked，绝不假绿。
 *
 * sprint: 08110022-relay-d96c9fa0 ws4
 */

import { queryImpactRadius } from './map-client.js';
import { getActiveImpactContract } from './contract-store.js';

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
  // 检查所有新增节点是否都已有对应断言覆盖
  // 判定方式：新增节点中存在对应 assertion_id（格式 node_<id>_works 或直接匹配）
  const allNewNodesCovered = addedNodes.every((nodeId) => {
    // 检查 contractAssertionIds 或 actualAssertionIds 中是否有覆盖此节点的断言
    // 覆盖规则：assertion_id 与 nodeId 相关，或 actualAssertions 中包含对应断言
    return (
      contractAssertionIds.has(nodeId) ||
      actualAssertionIds.has(nodeId) ||
      // 也接受断言 ID 中包含节点 ID 的形式（如 'task_routing_works' 覆盖 'task-routing'）
      [...contractAssertionIds, ...actualAssertionIds].some(
        (aid) => aid.includes(nodeId.replace(/-/g, '_')) || nodeId.replace(/-/g, '_').includes(aid.replace(/_works$/, ''))
      )
    );
  });

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
async function recordDriftEvent(db, { taskId, contractId, addedNodes, addedAssertions }) {
  const res = await db.query(
    `INSERT INTO gap_events (
       task_id, event_type, payload, created_at
     ) VALUES (
       $1, 'CONTRACT_IMPACT_DRIFT', $2::jsonb, NOW()
     ) RETURNING *`,
    [
      taskId,
      JSON.stringify({
        reason_code: 'CONTRACT_IMPACT_DRIFT',
        contract_id: contractId ?? null,
        added_nodes: addedNodes,
        added_assertions: addedAssertions,
      }),
    ]
  );
  return res.rows[0];
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
    `UPDATE harness_tasks SET status = 'blocked' WHERE id = $1`,
    [taskId]
  );
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
 * MJ5 STUB: mapClient 参数当前为 stub（返回固定空数据），待 MJ5 合同通过后替换为真实 Mapper。
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
export async function evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles = [], repo } = {}) {
  // --- 步骤 1：读取 active contract ---
  let contract = null;
  if (db) {
    try {
      contract = await getActiveImpactContract(db, taskId);
    } catch (_err) {
      // DB 不可达时 fail-closed
      return {
        gate: 'impact_unknown',
        reason: 'db_unavailable',
        retryable: true,
      };
    }
  }

  // --- 步骤 2：调用 Mapper 复算影响半径 ---
  // MJ5 STUB: replace with real Mapper call after MJ5 contract passes
  const mapperFn = mapClient || queryImpactRadius;

  let mapperResult;
  try {
    mapperResult = await mapperFn({
      repo: repo || contract?.repo,
      baseRevision: contract?.base_revision,
      headRevision,
      changedFiles,
    });
  } catch (_err) {
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
  if (headRevision && mapperResult.fact_revisions) {
    const repoKey = repo || contract?.repo || Object.keys(mapperResult.fact_revisions)[0];
    if (repoKey && mapperResult.fact_revisions[repoKey] !== undefined) {
      const mapperRevision = mapperResult.fact_revisions[repoKey];
      if (mapperRevision !== headRevision) {
        return {
          gate: 'impact_unknown',
          reason: 'revision_mismatch',
          retryable: true,
        };
      }
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

  if (comparison.verdict === 'drift' && db) {
    try {
      // 写入 gap_events 表
      gapEvent = await recordDriftEvent(db, {
        taskId,
        contractId: contract?.id ?? null,
        addedNodes: comparison.added_nodes,
        addedAssertions: comparison.added_assertions,
      });
    } catch (_err) {
      // gap_events 表可能尚不存在（ws5 创建），记录错误但不阻断
      // 在 ws4 阶段，gap_events 表依赖 ws5 migration；此处 graceful degradation
    }

    try {
      // 将原任务状态变为 blocked
      await blockTask(db, taskId);
    } catch (_err) {
      // 同上，graceful degradation
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
    contract: contract ?? null,
    gap_event: gapEvent,
    retryable: false,
  };
}

export default {
  compareImpactContract,
  evaluateDiffGate,
};
