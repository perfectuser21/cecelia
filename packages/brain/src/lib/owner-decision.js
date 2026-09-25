/**
 * 守卫 2：blocked_reason='owner_decision' 必须带协议（blocked_detail）。
 * 决策 105a5868 ②（决策分档）· 链 bf5088a3 棒5 · 任务 3fad28e0
 *
 * 病根：09-23 五把刀 blocked=owner_decision 却没写等什么，真因其实是机器故障，主理人被迫每天来问进度。
 * 协议：{ question, options[≥2], default, deadline, reversible, waiting_on: human|machine }。
 *   waiting_on=human   → 生成 pending_action（进主理人待办，expires_at=deadline）
 *   waiting_on=machine → 不进主理人待办（等的是机器，不该占主理人注意力）
 * 只拦新写入；存量 blocked 行不回填、不报错。四道入口同一份校验：
 *   blockTask / POST /tasks 建单 / createRoutedTask / 迁移 469 触发器（psql 直写，SQL 侧镜像本校验）。
 */

export const OWNER_DECISION_REASON = 'owner_decision';
export const WAITING_ON = Object.freeze(['human', 'machine']);
export const OWNER_DECISION_ACTION_TYPE = 'owner_decision';

export class OwnerDecisionProtocolError extends Error {
  /** @param {{field: string, reason: string}[]} violations */
  constructor(violations) {
    super(`owner_decision 缺协议：${violations.map((v) => `${v.field}(${v.reason})`).join('、')}`);
    this.name = 'OwnerDecisionProtocolError';
    this.code = 'owner_decision_protocol_violation';
    this.violations = violations;
  }
}

const nonBlankString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {unknown} detail blocked_detail
 * @returns {{ok: boolean, violations: {field: string, reason: string}[]}}
 */
export function validateOwnerDecisionDetail(detail) {
  const d = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const violations = [];
  if (!nonBlankString(d.question)) violations.push({ field: 'question', reason: '必须是非空字符串（一句话问题）' });
  if (!Array.isArray(d.options) || d.options.length < 2) violations.push({ field: 'options', reason: '必须是数组且至少 2 项' });
  const hasDefault = d.default != null && (typeof d.default !== 'string' || d.default.trim() !== '');
  if (!hasDefault) violations.push({ field: 'default', reason: '必须给出默认选项（到期不答按默认走）' });
  if (typeof d.deadline !== 'string' || Number.isNaN(Date.parse(d.deadline))) {
    violations.push({ field: 'deadline', reason: '必须是可解析的时间（ISO 8601）' });
  }
  if (typeof d.reversible !== 'boolean') violations.push({ field: 'reversible', reason: '必须是布尔值' });
  if (!WAITING_ON.includes(d.waiting_on)) violations.push({ field: 'waiting_on', reason: `必须是 ${WAITING_ON.join('|')}` });
  return { ok: violations.length === 0, violations };
}

/**
 * 仅对 reason==='owner_decision' 生效；其它 blocked_reason 语义不变。
 * @throws {OwnerDecisionProtocolError}
 */
export function assertOwnerDecisionProtocol({ reason, detail }) {
  if (reason !== OWNER_DECISION_REASON) return;
  const { ok, violations } = validateOwnerDecisionDetail(detail);
  if (!ok) throw new OwnerDecisionProtocolError(violations);
}

export const ownerDecisionSignature = (taskId) => `owner-decision:${taskId}`;

/**
 * waiting_on=human 才生成主理人待办（pending_actions）；同任务已有未决则不重复生成。
 * @returns {Promise<{created: true, id: string} | {created: false, skipped: 'machine'|'exists', id?: string}>}
 */
export async function openOwnerDecisionPendingAction(db, { taskId, title, detail }) {
  if (detail?.waiting_on !== 'human') return { created: false, skipped: 'machine' };
  const signature = ownerDecisionSignature(taskId);
  const existing = await db.query(
    `SELECT id FROM pending_actions WHERE signature = $1 AND status = 'pending_approval' LIMIT 1`,
    [signature],
  );
  if (existing.rows.length > 0) return { created: false, skipped: 'exists', id: existing.rows[0].id };
  const deadline = new Date(detail.deadline);
  const inserted = await db.query(
    `INSERT INTO pending_actions
       (action_type, params, context, status, expires_at, category, priority, source, signature, options, comments)
     VALUES ('owner_decision', $1::jsonb, $2::jsonb, 'pending_approval', $3, 'approval', 'urgent', 'owner_decision_guard', $4, $5::jsonb, '[]'::jsonb)
     RETURNING id`,
    [
      JSON.stringify({ task_id: taskId, default: detail.default, reversible: detail.reversible }),
      JSON.stringify({ title: `待拍板：${title || taskId}`, task_id: taskId, question: detail.question, deadline: detail.deadline }),
      Number.isNaN(deadline.getTime()) ? null : deadline.toISOString(),
      signature,
      JSON.stringify(detail.options),
    ],
  );
  return { created: true, id: inserted.rows[0].id };
}

/** 任务解除阻塞后关闭它未决的待办（不留过期的「等你拍板」）。 */
export async function closeOwnerDecisionPendingAction(db, taskId) {
  const r = await db.query(
    `UPDATE pending_actions
        SET status = 'approved', reviewed_by = 'task-unblock', reviewed_at = NOW()
      WHERE signature = $1 AND status = 'pending_approval'`,
    [ownerDecisionSignature(taskId)],
  );
  return { closed: r.rowCount ?? 0 };
}
