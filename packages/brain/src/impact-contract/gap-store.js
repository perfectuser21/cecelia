/** Gap Ledger 状态机与持久化；resolved 只接受当前合同的可信 receipt。 */

import { createHash } from 'node:crypto';
import { canonicalAssertionArgv } from '../lib/gp-assertion-command.js';

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

function assertionSourceBindings(assertion) {
  const bindings = Array.isArray(assertion?.source_bindings) && assertion.source_bindings.length > 0
    ? assertion.source_bindings
    : [{
      journey_step_link_id: assertion?.journey_step_link_id,
      assertion_revision: assertion?.assertion_revision,
      assertion_digest: assertion?.assertion_digest,
    }];
  return bindings;
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
  const isPool = typeof db.connect === 'function' && db.constructor?.name !== 'Client';
  const client = isPool ? await db.connect() : db;

  try {
    if (isPool) await client.query('BEGIN');

    // 若 owner 为空则进入 triage
    const initialStatus = owner ? 'open' : 'triage';

    // 幂等插入（ON CONFLICT 返回已有记录）
    const insertResult = await client.query(
      `INSERT INTO harness_gaps
         (source_task_id, impact_node_id, owner, severity, status, current_revision)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_task_id, impact_node_id, current_revision)
         DO UPDATE SET updated_at = NOW()
       RETURNING *, (xmax = 0) AS created`,
      [sourceTaskId, impactNodeId, owner, severity, initialStatus, revision]
    );

    const { created: inserted, ...gap } = insertResult.rows[0];
    const created = Boolean(inserted);

    // 写 discovered 事件（幂等）
    const effectiveKey = idempotencyKey ?? `discovered:${gap.id}:${revision ?? 'no-rev'}`;

    await client.query(
      `INSERT INTO gap_events (gap_id, event_type, idempotency_key, actor, detail, revision)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (gap_id, idempotency_key) DO NOTHING`,
      [gap.id, 'CONTRACT_IMPACT_DRIFT', effectiveKey, owner, { impact_node_id: impactNodeId, severity }, revision]
    );

    // 若 triage，写告警（gap_events 类型复用 discovered，携带告警详情）
    if (initialStatus === 'triage') {
      await client.query(
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

    if (isPool) await client.query('COMMIT');
    return { gap, created };
  } catch (error) {
    if (isPool) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (isPool) client.release();
  }
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
async function transitionGapStatusOnClient(db, gapId, newStatus, {
  actor = null,
  detail = null,
  idempotencyKey = null,
  resolutionEvidence = null,
} = {}) {
  // 读取当前 gap
  const gapResult = await db.query(
    'SELECT * FROM harness_gaps WHERE id = $1 FOR UPDATE',
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

  // 幂等性必须先于状态机校验：首次 resolved 已改变状态，重复回调仍应返回原事件。
  if (idempotencyKey) {
    const existingEvent = await db.query(
      'SELECT * FROM gap_events WHERE gap_id = $1 AND idempotency_key = $2',
      [gapId, idempotencyKey]
    );
    if (existingEvent.rows.length > 0) {
      return { gap, event: existingEvent.rows[0] };
    }
  }

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
    if (!resolutionEvidence.revision || resolutionEvidence.revision !== gap.current_revision) {
      const err = new Error('resolution_evidence.revision 与 gap current_revision 不一致');
      err.code = 'revision_mismatch';
      err.httpStatus = 409;
      throw err;
    }
    if (!resolutionEvidence.receipt_id || resolutionEvidence.assertion_receipt) {
      const err = new Error('resolved 状态只接受不可变 assertion receipt_id');
      err.code = 'invalid_resolution_evidence';
      err.httpStatus = 422;
      throw err;
    }

    if (!gap.repair_task_id) {
      const err = new Error('resolved 状态需要已绑定的 repair task');
      err.code = 'repair_task_missing';
      err.httpStatus = 409;
      throw err;
    }
    await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [gap.source_task_id]);
    const repairResult = await db.query(
      'SELECT status, completed_at FROM tasks WHERE id = $1',
      [gap.repair_task_id]
    );
    const repairTask = repairResult.rows[0];
    if (repairTask?.status !== 'completed' || !repairTask.completed_at) {
      const err = new Error('repair task 尚未完成');
      err.code = 'repair_task_incomplete';
      err.httpStatus = 409;
      throw err;
    }

    const contractResult = await db.query(
      `SELECT id, contract_hash, repo, contract_body
       FROM harness_impact_contracts
       WHERE task_id = $1 AND status = 'active'
       ORDER BY version DESC
       LIMIT 1
       FOR UPDATE`,
      [gap.source_task_id]
    );
    const contractAssertions = contractResult.rows[0]?.contract_body?.required_assertions ?? [];
    const contractAssertion = contractAssertions.find((assertion) => (
      assertion
      && typeof assertion === 'object'
      && assertion.assertion_id === resolutionEvidence.assertion_id
    ));
    if (!contractAssertion) {
      const err = new Error('assertion 不属于当前 active Impact Contract');
      err.code = 'assertion_not_in_contract';
      err.httpStatus = 409;
      throw err;
    }
    const sourceBindings = assertionSourceBindings(contractAssertion);
    if (sourceBindings.some((binding) => (
      !binding?.journey_step_link_id
      || !Number.isInteger(binding.assertion_revision)
      || !/^[0-9a-f]{64}$/.test(binding.assertion_digest ?? '')
    ))) {
      const err = new Error('active Impact Contract 缺少不可变断言绑定');
      err.code = 'assertion_binding_missing';
      err.httpStatus = 409;
      throw err;
    }
    if (!contractAssertion.covers_capability_ids?.includes(gap.impact_node_id)) {
      const err = new Error('assertion 未覆盖当前 gap 的 impact node');
      err.code = 'assertion_not_covering_gap';
      err.httpStatus = 409;
      throw err;
    }

    const verificationResult = await db.query(
      `SELECT MAX(created_at) AS verification_started_at
       FROM gap_events
       WHERE gap_id = $1 AND event_type = 'verification_started'`,
      [gapId]
    );
    const verificationStartedAt = verificationResult.rows[0]?.verification_started_at;
    if (!verificationStartedAt) {
      const err = new Error('缺少 verification_started 事件');
      err.code = 'verification_not_started';
      err.httpStatus = 409;
      throw err;
    }

    const receiptResult = await db.query(
      `SELECT receipt.*,
              link.assertion_ref AS current_assertion_ref,
              link.assertion_revision AS current_assertion_revision,
              verification_run.current_task_id AS verification_task_id
       FROM journey_assertion_receipts AS receipt
       JOIN journey_step_links AS link ON link.id = receipt.journey_step_link_id
       JOIN initiative_runs AS verification_run
         ON verification_run.id::text = receipt.run_id
        AND verification_run.current_task_id = $2
       JOIN harness_attempts AS attempt
         ON attempt.id = receipt.harness_attempt_id
        AND attempt.run_id::text = receipt.run_id
        AND attempt.role = 'evaluator'
        AND attempt.status = 'completed'
        AND attempt.result->'decision'->>'outcome' IN ('PASS', 'FIXED')
       WHERE receipt.assertion_ref_snapshot = $1
         AND receipt.impact_contract_id = $3
         AND receipt.impact_contract_hash = $4
         AND receipt.source_repo = $5
         AND receipt.source_sha = $6`,
      [
        resolutionEvidence.assertion_id,
        gap.repair_task_id,
        contractResult.rows[0]?.id,
        contractResult.rows[0]?.contract_hash,
        contractResult.rows[0]?.repo,
        gap.current_revision,
      ]
    );
    const expectedDigest = createHash('sha256')
      .update(String(resolutionEvidence.assertion_id))
      .digest('hex');
    const trustedReceipts = receiptResult.rows.filter((receipt) => (
      receipt
      && receipt.verdict === 'PASS'
      && receipt.exit_code === 0
      && receipt.synthetic === false
      && receipt.executor_kind === 'brain_assertion_runner'
      && typeof receipt.machine_id === 'string'
      && receipt.machine_id.trim().length > 0
      && receipt.source_repo === contractResult.rows[0]?.repo
      && /^[0-9a-f]{40}$/.test(receipt.source_sha ?? '')
      && receipt.source_sha === gap.current_revision
      && receipt.impact_contract_id === contractResult.rows[0]?.id
      && receipt.impact_contract_hash === contractResult.rows[0]?.contract_hash
      && receipt.verification_task_id === gap.repair_task_id
      && receipt.assertion_ref_snapshot === resolutionEvidence.assertion_id
      && receipt.current_assertion_ref === receipt.assertion_ref_snapshot
      && Number(receipt.current_assertion_revision) === Number(receipt.assertion_revision)
      && receipt.assertion_digest === expectedDigest
      && JSON.stringify(receipt.command_argv)
        === JSON.stringify(canonicalAssertionArgv(contractAssertion.assertion_id))
      && Date.parse(receipt.completed_at) >= Date.parse(verificationStartedAt)
      && typeof receipt.output_digest === 'string'
      && /^[0-9a-f]{64}$/.test(receipt.output_digest)
      && Number(receipt.scenario_count) > 0
      && receipt.scenario_evidence
      && Object.keys(receipt.scenario_evidence).length > 0
    ));
    const submittedReceiptTrusted = trustedReceipts.some(
      (receipt) => receipt.id === resolutionEvidence.receipt_id,
    );
    const allBindingsCovered = sourceBindings.every((binding) => trustedReceipts.some((receipt) => (
      receipt.journey_step_link_id === binding.journey_step_link_id
      && Number(receipt.assertion_revision) === binding.assertion_revision
      && receipt.assertion_digest === binding.assertion_digest
    )));
    if (!submittedReceiptTrusted || !allBindingsCovered) {
      const err = new Error('assertion receipt 不可信、已过期或 revision 不匹配');
      err.code = 'invalid_resolution_evidence';
      err.httpStatus = 422;
      throw err;
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
      `UPDATE harness_gap_dependencies
       SET status = 'satisfied', updated_at = NOW()
       WHERE gap_id = $1 AND status = 'pending'`,
      [gapId]
    );
    await db.query(
      `UPDATE task_dependencies AS dependency
       SET status = 'satisfied'
       WHERE dependency.from_task_id = $1
         AND dependency.to_task_id = $2
         AND dependency.status = 'pending'
         AND NOT EXISTS (
           SELECT 1
           FROM harness_gap_dependencies AS pending_gap
           WHERE pending_gap.source_task_id = dependency.from_task_id
             AND pending_gap.repair_task_id = dependency.to_task_id
             AND pending_gap.status = 'pending'
         )`,
      [gap.source_task_id, gap.repair_task_id]
    );
    await db.query(
      `UPDATE tasks AS source
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           blocked_at = NULL,
           blocked_reason = NULL,
           blocked_detail = NULL,
           blocked_until = NULL,
           started_at = NULL,
           updated_at = NOW()
       WHERE source.id = $1
         AND source.status = 'blocked'
         AND NOT EXISTS (
           SELECT 1
           FROM harness_gaps AS unresolved
           WHERE unresolved.source_task_id = source.id
             AND unresolved.status <> 'resolved'
         )`,
      [gap.source_task_id]
    );
  }

  return { gap: updatedGap, event };
}

export async function transitionGapStatus(db, gapId, newStatus, options = {}) {
  const isPool = typeof db.connect === 'function' && db.constructor?.name !== 'Client';
  const client = isPool ? await db.connect() : db;
  try {
    if (isPool) await client.query('BEGIN');
    const result = await transitionGapStatusOnClient(client, gapId, newStatus, options);
    if (isPool) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (isPool) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (isPool) client.release();
  }
}

/**
 * assignRepairTask(db, gapId, repairTaskId) — 关联修复任务。
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} gapId
 * @param {string} repairTaskId
 * @returns {Promise<object>} 更新后的 gap
 */
export {
  addHardDependency,
  assignRepairTask,
  assignRepairTaskWithDependency,
  createRepairTaskForGap,
  getDependenciesByTask,
  getGapById,
  getGapEvents,
  getGapsByTask,
  listGapsByStatus,
} from './gap-dependencies.js';
