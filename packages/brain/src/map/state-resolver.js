/**
 * Query-time State Resolver
 * PRD: Universal Map Projection Engine, 刀3
 *
 * 状态必须查询时计算，禁止拿历史 cell_status 冒充当前事实。
 * 陈旧即未知，禁止旧绿假装健康。
 *
 * 状态枚举：green / red / gray / unknown / not_applicable
 */

import pool from '../db.js';

/** 事实源陈旧预算（秒）：超出则状态降为 unknown */
const FRESHNESS_BUDGET_SECONDS = 15 * 60; // 15 分钟

/**
 * 计算事实源 freshness
 * @param {Date|string|null} scannedAt
 * @returns {{ fresh: boolean, age_seconds: number }}
 */
export function computeSnapshotFreshness(scannedAt) {
  if (!scannedAt) return { fresh: false, age_seconds: Infinity };
  const ageMs = Date.now() - new Date(scannedAt).getTime();
  const ageSeconds = ageMs / 1000;
  return { fresh: ageSeconds <= FRESHNESS_BUDGET_SECONDS, age_seconds: Math.round(ageSeconds) };
}

/**
 * 获取 graph_edges 最新 scanned_at（按 repo）
 */
async function getGraphFreshness(repo) {
  const { rows } = await pool.query(
    `SELECT MAX(scanned_at) AS latest FROM graph_edges WHERE repo = $1`,
    [repo]
  );
  return computeSnapshotFreshness(rows[0]?.latest ?? null);
}

/**
 * 获取 test_registry 最新 scanned_at（按 repo）
 */
async function getTestFreshness(repo) {
  const { rows } = await pool.query(
    `SELECT MAX(scanned_at) AS latest FROM test_registry WHERE repo = $1`,
    [repo]
  );
  return computeSnapshotFreshness(rows[0]?.latest ?? null);
}

/**
 * 获取 api_registry 最新 scanned_at（按 repo）
 */
async function getApiFreshness(repo) {
  const { rows } = await pool.query(
    `SELECT MAX(scanned_at) AS latest FROM api_registry WHERE repo = $1`,
    [repo]
  );
  return computeSnapshotFreshness(rows[0]?.latest ?? null);
}

/**
 * 获取 db_schema_registry 最新 scanned_at（按 repo）
 */
async function getDbSchemaFreshness(repo) {
  const { rows } = await pool.query(
    `SELECT MAX(scanned_at) AS latest FROM db_schema_registry WHERE repo = $1`,
    [repo]
  );
  return computeSnapshotFreshness(rows[0]?.latest ?? null);
}

/**
 * 检查节点的锚点状态（通过 journey_features）
 * @param {string} nodeKey - capability/feature key
 * @returns {{ has_anchor: boolean, anchors: object[] }}
 */
async function resolveAnchors(nodeKey) {
  // 尝试从 journey_features 匹配（旧账本兼容层）
  const { rows } = await pool.query(
    `SELECT jf.id, jf.name, jf.status, jf.unit_test_path, jf.workflow_ref, jf.guard_ref,
            jf.scanned_at
     FROM journey_features jf
     WHERE jf.status != 'deprecated'
       AND (
         jf.name ILIKE $1
         OR jf.unit_test_path ILIKE $1
         OR (jf.guard_ref IS NOT NULL AND jf.guard_ref ILIKE $1)
       )
     LIMIT 20`,
    [`%${nodeKey}%`]
  );
  return {
    has_anchor: rows.length > 0,
    anchors: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      unit_test_path: r.unit_test_path,
      workflow_ref: r.workflow_ref,
      guard_ref: r.guard_ref,
    })),
  };
}

/**
 * 获取节点关联的最近 assertion receipt（绑定 source_sha）
 * @param {string} nodeKey
 * @param {string|null} currentRevision - 当前 source revision
 * @returns {{ verdict: 'PASS'|'FAIL'|null, revision_match: boolean, receipt: object|null }}
 */
async function getLatestReceipt(nodeKey, currentRevision) {
  // 通过 journey_features 关联到 journey_step_links 再到 receipts
  const { rows } = await pool.query(
    `SELECT jar.verdict, jar.source_sha, jar.started_at, jar.completed_at,
            jar.assertion_ref_snapshot, jar.machine_id
     FROM journey_assertion_receipts jar
     JOIN journey_step_links jsl ON jsl.id = jar.journey_step_link_id
     JOIN journey_features jf ON jf.id = jsl.feature_id
     WHERE jf.name ILIKE $1
       OR jf.unit_test_path ILIKE $1
     ORDER BY jar.completed_at DESC
     LIMIT 1`,
    [`%${nodeKey}%`]
  );

  if (rows.length === 0) return { verdict: null, revision_match: false, receipt: null };

  const receipt = rows[0];
  const revisionMatch = currentRevision ? receipt.source_sha === currentRevision : false;

  return {
    verdict: receipt.verdict,
    revision_match: revisionMatch,
    receipt: {
      source_sha: receipt.source_sha,
      started_at: receipt.started_at,
      completed_at: receipt.completed_at,
      assertion_ref: receipt.assertion_ref_snapshot,
      machine_id: receipt.machine_id,
    },
  };
}

/**
 * 计算单个节点的当前状态
 *
 * green: 锚点目标存在 + 事实源新鲜 + 当前 revision 有有效 PASS receipt
 * red: 锚点目标存在 + 事实源新鲜 + 当前 revision 最近有效 receipt 为 FAIL
 * gray: 没有已批准锚点，或新鲜事实已证明锚点目标不存在
 * unknown: 扫描陈旧、revision 不可得、receipt 与当前 revision 不一致
 * not_applicable: manifest 明确声明不适用
 */
export async function resolveNodeState(nodeKey, { repo, notApplicable = false } = {}) {
  if (notApplicable) {
    return { state: 'not_applicable', reason_code: 'manifest_declared', details: {} };
  }

  // 检查事实源新鲜度
  const [graphFresh, testFresh] = await Promise.all([
    getGraphFreshness(repo),
    getTestFreshness(repo),
  ]);

  const factStale = !graphFresh.fresh && !testFresh.fresh;

  // 解析锚点
  const anchorInfo = await resolveAnchors(nodeKey);

  if (!anchorInfo.has_anchor) {
    return {
      state: 'gray',
      reason_code: 'no_anchor',
      details: { graph_fresh: graphFresh, test_fresh: testFresh },
    };
  }

  // 获取当前 revision
  let currentRevision = null;
  try {
    const { rows } = await pool.query(
      `SELECT source_revision FROM graph_edges WHERE repo = $1 AND source_revision IS NOT NULL LIMIT 1`,
      [repo]
    );
    currentRevision = rows[0]?.source_revision || null;
  } catch { /* ignored */ }

  if (factStale) {
    return {
      state: 'unknown',
      reason_code: 'fact_stale',
      details: {
        graph_age_seconds: graphFresh.age_seconds,
        test_age_seconds: testFresh.age_seconds,
        anchors: anchorInfo.anchors,
      },
    };
  }

  // 获取 receipt
  const receiptInfo = await getLatestReceipt(nodeKey, currentRevision);

  if (!receiptInfo.verdict) {
    return {
      state: 'gray',
      reason_code: 'no_receipt',
      details: { anchors: anchorInfo.anchors, current_revision: currentRevision },
    };
  }

  if (receiptInfo.verdict === 'PASS' && receiptInfo.revision_match) {
    return {
      state: 'green',
      reason_code: 'pass_current_revision',
      details: { receipt: receiptInfo.receipt, current_revision: currentRevision },
    };
  }

  if (receiptInfo.verdict === 'FAIL') {
    return {
      state: 'red',
      reason_code: 'fail_current_revision',
      details: { receipt: receiptInfo.receipt, current_revision: currentRevision },
    };
  }

  // PASS 但 revision 不匹配 → unknown
  return {
    state: 'unknown',
    reason_code: 'revision_mismatch',
    details: {
      receipt_sha: receiptInfo.receipt?.source_sha,
      current_revision: currentRevision,
      verdict: receiptInfo.verdict,
    },
  };
}

/**
 * 聚合规则：Capability 状态
 * 任一必需子项 red → red；无 red 但有 unknown → unknown；必需子项全 green → green；其余 gray
 */
export function aggregateCapabilityState(childStates) {
  if (childStates.length === 0) return 'gray';
  const states = childStates.map((s) => s.state || s);
  if (states.includes('red')) return 'red';
  if (states.includes('unknown')) return 'unknown';
  if (states.every((s) => s === 'green')) return 'green';
  return 'gray';
}

/**
 * 计算整个 scope 的所有节点状态（批量，查询时现算）
 * @param {string} scopeKey
 * @param {object[]} nodes - 当前 active projection nodes
 * @returns {Map<string, object>} nodeKey → stateInfo
 */
export async function resolveAllNodeStates(scopeKey, nodes) {
  const stateMap = new Map();

  await Promise.all(
    nodes.map(async (node) => {
      const repo = scopeKey; // 约定：scope_key 对应同名 repo
      const notApplicable = node.attributes?.not_applicable === true;

      try {
        const stateInfo = await resolveNodeState(node.node_key, { repo, notApplicable });
        stateMap.set(node.node_key, stateInfo);
      } catch {
        stateMap.set(node.node_key, {
          state: 'unknown',
          reason_code: 'resolver_error',
          details: {},
        });
      }
    })
  );

  return stateMap;
}

/**
 * 获取 scope 级别的健康摘要
 * @param {string} scopeKey
 * @param {string} repo
 */
export async function getFactHealthSummary(scopeKey, repo) {
  const [graphFresh, testFresh, apiFresh, dbFresh] = await Promise.all([
    getGraphFreshness(repo || scopeKey),
    getTestFreshness(repo || scopeKey),
    getApiFreshness(repo || scopeKey),
    getDbSchemaFreshness(repo || scopeKey),
  ]);

  return {
    graph_edges: graphFresh,
    test_registry: testFresh,
    api_registry: apiFresh,
    db_schema_registry: dbFresh,
    overall: (graphFresh.fresh && testFresh.fresh) ? 'fresh' : 'stale',
  };
}
