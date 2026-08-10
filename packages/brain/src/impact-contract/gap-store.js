/**
 * gap-store.js — Gap Ledger 持久化层（FR-5）
 *
 * 实现 Gap 生命周期状态机：
 *   open → assigned → fixing → verifying → resolved（终态）
 *   verifying → reopened → assigned（验证失败回滚）
 *
 * 规则：
 * - 非法跳转 → 抛出 { code: 'invalid_transition' } 错误
 * - 重复回调（同 idempotency_key）→ 幂等返回，不重复建事件
 * - verifying → resolved 需要 resolution_evidence（含 assertion_id / assertion_receipt / revision）
 * - owner 不存在 → gap 进入 triage 状态，写告警记录
 *
 * sprint: 08110022-relay-d96c9fa0 ws5
 */

// ---------- 状态机定义 ----------

/**
 * VALID_TRANSITIONS — 状态机合法跳转表。
 * key: 当前状态，value: 可跳转的目标状态列表。
 */
export const VALID_TRANSITIONS = {
  open: ['assigned', 'triage'],
  triage: ['assigned'],
  assigned: ['fixing', 'open'],   // 允许 reassign 时退回 open
  fixing: ['verifying'],
  verifying: ['resolved', 'reopened'],
  reopened: ['assigned'],
  resolved: [],                   // 终态，不可再转
};

/**
 * isValidTransition(from, to) — 纯函数，检查状态机跳转是否合法。
 *
 * @param {string} from  当前状态
 * @param {string} to    目标状态
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * validateTransition(from, to) — 校验跳转，非法时抛错。
 *
 * @throws {{ code: 'invalid_transition', from, to, allowed }}
 */
export function validateTransition(from, to) {
  if (!isValidTransition(from, to)) {
    const allowed = VALID_TRANSITIONS[from] ?? [];
    const err = new Error(
      `invalid_transition: ${from} → ${to}（允许：${allowed.join(', ') || '无（终态）'}）`
    );
    err.code = 'invalid_transition';
    err.from = from;
    err.to = to;
    err.allowed = allowed;
    err.httpStatus = 422;
    throw err;
  }
}

// ---------- 写操作 ----------

/**
 * openGapForDrift(db, input) — 为 drift 事件开一个新的 gap。
 *
 * 幂等语义：同 (source_task_id, impact_node_id, current_revision) 已存在时返回已有 gap。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {{
 *   sourceTaskId: string,
 *   impactNodeId: string,
 *   owner?: string,
 *   severity?: string,
 *   revision?: string,
 *   idempotencyKey?: string,
 * }} input
 * @returns {Promise<{ gap: object, created: boolean }>}
 */
export async function openGapForDrift(db, {
  sourceTaskId,
  impactNodeId,
  owner = null,
  severity = 'medium',
  revision = null,
  idempotencyKey = null,
}) {
  // 若 owner 为空则进入 triage
  const initialStatus = owner ? 'open' : 'triage';

  // 幂等插入（ON CONFLICT 返回已有记录）
  const insertResult = await db.query(
    `INSERT INTO harness_gaps
       (source_task_id, impact_node_id, owner, severity, status, current_revision)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_task_id, impact_node_id, current_revision)
       DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [sourceTaskId, impactNodeId, owner, severity, initialStatus, revision]
  );

  const gap = insertResult.rows[0];
  const created = gap.updated_at === gap.created_at ||
    Math.abs(new Date(gap.updated_at) - new Date(gap.created_at)) < 100;

  // 写 discovered 事件（幂等）
  const effectiveKey = idempotencyKey ?? `discovered:${gap.id}:${revision ?? 'no-rev'}`;

  await db.query(
    `INSERT INTO gap_events (gap_id, event_type, idempotency_key, actor, detail, revision)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (gap_id, idempotency_key) DO NOTHING`,
    [gap.id, 'CONTRACT_IMPACT_DRIFT', effectiveKey, owner, { impact_node_id: impactNodeId, severity }, revision]
  );

  // 若 triage，写告警（gap_events 类型复用 discovered，携带告警详情）
  if (initialStatus === 'triage') {
    await db.query(
      `INSERT INTO gap_events (gap_id, event_type, idempotency_key, actor, detail, revision)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (gap_id, idempotency_key) DO NOTHING`,
      [
        gap.id,
        'discovered',
        `triage-alert:${gap.id}`,
        null,
        { alert: 'owner_not_found', message: `Gap ${gap.id} 无 owner，进入分诊队列` },
        revision,
      ]
    );
  }

  return { gap, created };
}

/**
 * transitionGapStatus(db, gapId, newStatus, options) — 执行状态机跳转。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} gapId
 * @param {string} newStatus
 * @param {{
 *   actor?: string,
 *   detail?: object,
 *   idempotencyKey?: string,
 *   resolutionEvidence?: object,
 * }} options
 * @returns {Promise<{ gap: object, event: object | null }>}
 */
export async function transitionGapStatus(db, gapId, newStatus, {
  actor = null,
  detail = null,
  idempotencyKey = null,
  resolutionEvidence = null,
} = {}) {
  // 读取当前 gap
  const gapResult = await db.query(
    'SELECT * FROM harness_gaps WHERE id = $1',
    [gapId]
  );

  if (gapResult.rows.length === 0) {
    const err = new Error(`gap_not_found: ${gapId}`);
    err.code = 'gap_not_found';
    err.httpStatus = 404;
    throw err;
  }

  const gap = gapResult.rows[0];
  const currentStatus = gap.status;

  // 状态机校验（抛出 invalid_transition）
  validateTransition(currentStatus, newStatus);

  // resolved 必须提供 resolution_evidence
  if (newStatus === 'resolved') {
    if (!resolutionEvidence || !resolutionEvidence.assertion_id) {
      const err = new Error('resolved 状态需要 resolution_evidence.assertion_id');
      err.code = 'missing_resolution_evidence';
      err.httpStatus = 422;
      throw err;
    }
  }

  // 幂等性：同 idempotencyKey 已存在则直接返回
  if (idempotencyKey) {
    const existingEvent = await db.query(
      'SELECT * FROM gap_events WHERE gap_id = $1 AND idempotency_key = $2',
      [gapId, idempotencyKey]
    );
    if (existingEvent.rows.length > 0) {
      return { gap, event: existingEvent.rows[0] };
    }
  }

  // 更新 gap 状态
  const updateResult = await db.query(
    `UPDATE harness_gaps
     SET status = $1,
         resolution_evidence = COALESCE($2::jsonb, resolution_evidence),
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [newStatus, resolutionEvidence ? JSON.stringify(resolutionEvidence) : null, gapId]
  );

  const updatedGap = updateResult.rows[0];

  // 映射事件类型
  const EVENT_TYPE_MAP = {
    assigned: 'assigned',
    fixing: 'fix_started',
    verifying: 'verification_started',
    resolved: 'resolved',
    reopened: 'reopened',
    open: 'assigned',    // reassign 退回 open 时
    triage: 'discovered',
  };

  const eventType = EVENT_TYPE_MAP[newStatus] ?? newStatus;
  const effectiveKey = idempotencyKey ?? `${eventType}:${gapId}:${Date.now()}`;

  const eventResult = await db.query(
    `INSERT INTO gap_events (gap_id, event_type, idempotency_key, actor, detail, revision)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (gap_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      gapId,
      eventType,
      effectiveKey,
      actor,
      detail ? JSON.stringify(detail) : null,
      resolutionEvidence?.revision ?? null,
    ]
  );

  const event = eventResult.rows[0] ?? null;

  // resolved 后更新 task_dependencies
  if (newStatus === 'resolved') {
    await db.query(
      `UPDATE task_dependencies
       SET status = 'satisfied'
       WHERE gap_id = $1 AND status = 'pending'`,
      [gapId]
    );
  }

  return { gap: updatedGap, event };
}

/**
 * assignRepairTask(db, gapId, repairTaskId) — 关联修复任务。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} gapId
 * @param {string} repairTaskId
 * @returns {Promise<object>} 更新后的 gap
 */
export async function assignRepairTask(db, gapId, repairTaskId) {
  const result = await db.query(
    `UPDATE harness_gaps SET repair_task_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [repairTaskId, gapId]
  );

  if (result.rows.length === 0) {
    const err = new Error(`gap_not_found: ${gapId}`);
    err.code = 'gap_not_found';
    err.httpStatus = 404;
    throw err;
  }

  return result.rows[0];
}

/**
 * addHardDependency(db, input) — 为原任务添加硬依赖阻塞。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {{
 *   fromTaskId: string,   // 被阻塞的原任务
 *   toTaskId: string,     // 修复任务（解锁条件）
 *   gapId: string,
 *   edgeType?: string,    // 'hard' | 'soft'
 * }} input
 * @returns {Promise<{ dep: object, created: boolean }>}
 */
export async function addHardDependency(db, { fromTaskId, toTaskId, gapId, edgeType = 'hard' }) {
  const result = await db.query(
    `INSERT INTO task_dependencies (from_task_id, to_task_id, gap_id, edge_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_task_id, to_task_id, gap_id)
       DO UPDATE SET status = 'pending', edge_type = EXCLUDED.edge_type
     RETURNING *, (xmax = 0) AS created`,
    [fromTaskId, toTaskId, gapId, edgeType]
  );

  const row = result.rows[0];
  return { dep: row, created: row.created };
}

// ---------- 读操作 ----------

/**
 * listGapsByStatus(db, status) — 按状态列出所有 gap（用于全局视图/评估器巡检）。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} status
 * @returns {Promise<object[]>}
 */
export async function listGapsByStatus(db, status) {
  const result = await db.query(
    `SELECT * FROM harness_gaps WHERE status = $1 ORDER BY created_at DESC`,
    [status]
  );
  return result.rows;
}

/**
 * getGapsByTask(db, taskId) — 查询任务的所有 gap（包括作为 source 或 repair 的）。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<object[]>}
 */
export async function getGapsByTask(db, taskId) {
  const result = await db.query(
    `SELECT * FROM harness_gaps
     WHERE source_task_id = $1 OR repair_task_id = $1
     ORDER BY created_at DESC`,
    [taskId]
  );
  return result.rows;
}

/**
 * getGapById(db, gapId) — 按 id 获取单个 gap。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} gapId
 * @returns {Promise<object|null>}
 */
export async function getGapById(db, gapId) {
  const result = await db.query(
    'SELECT * FROM harness_gaps WHERE id = $1',
    [gapId]
  );
  return result.rows[0] ?? null;
}

/**
 * getGapEvents(db, gapId) — 查询 gap 的完整事件链。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} gapId
 * @returns {Promise<object[]>}
 */
export async function getGapEvents(db, gapId) {
  const result = await db.query(
    `SELECT * FROM gap_events
     WHERE gap_id = $1
     ORDER BY created_at ASC`,
    [gapId]
  );
  return result.rows;
}

/**
 * getDependenciesByTask(db, taskId) — 查询任务的硬依赖关系。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<object[]>}
 */
export async function getDependenciesByTask(db, taskId) {
  const result = await db.query(
    `SELECT * FROM task_dependencies
     WHERE from_task_id = $1 OR to_task_id = $1
     ORDER BY created_at DESC`,
    [taskId]
  );
  return result.rows;
}
