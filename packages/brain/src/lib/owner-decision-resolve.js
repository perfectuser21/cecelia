/**
 * owner_decision 应答核心：批准与「到期按默认」共用同一个内部函数。
 * 决策 105a5868 三档协议最后一环 · 链 bf5088a3 棒 9 · 任务 8aa79219
 *
 * 棒 5 让 blocked_reason='owner_decision' 必带协议并为 waiting_on=human 生成待办，但缺应答通路：
 * actionHandlers 没有 owner_decision（点批准 → No handler），「到期不答按默认走」也没有代码执行。
 *
 * 事务边界由调用方管（批准走 approvePendingAction 的事务；sweeper 走自己的事务）。
 * 函数内全部写入都经传入的 db（client），任何一步失败调用方 ROLLBACK，不留半截状态。
 */
import { OWNER_DECISION_REASON, ownerDecisionSignature } from './owner-decision.js';
import { unblockTask } from '../task-updater.js';

export const RESOLUTION_VIA = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
  DEFAULT_ON_DEADLINE: 'default_on_deadline',
});

export class OwnerDecisionResolveError extends Error {
  /** @param {string} message @param {{status?: number, code?: string}} [opts] */
  constructor(message, { status = 400, code = 'owner_decision_resolve_error' } = {}) {
    super(message);
    this.name = 'OwnerDecisionResolveError';
    this.status = status;
    this.code = code;
  }
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** 选项全文：字符串原样；对象取 text/title/label/description，都没有则 JSON。 */
function optionText(o) {
  if (typeof o === 'string') return o.trim();
  if (o && typeof o === 'object') {
    const t = o.text ?? o.title ?? o.label ?? o.description;
    return typeof t === 'string' && t.trim() !== '' ? t.trim() : JSON.stringify(o);
  }
  return String(o ?? '').trim();
}

/** 选项标签：对象取 id/key/label；字符串取首个「字母数字下划线」token（后接空白/冒号/句点/括号/顿号/结尾）。 */
function optionLabel(o) {
  if (o && typeof o === 'object') {
    const l = o.id ?? o.key ?? o.label;
    if (l != null && String(l).trim() !== '') return String(l).trim();
  }
  const m = /^\s*([A-Za-z0-9_]+)(?=[\s:：.)）、]|$)/.exec(optionText(o));
  return m ? m[1] : null;
}

/**
 * 按选项全文或前缀标签匹配（大小写不敏感）。全文优先；标签必须唯一命中，歧义不猜。
 * @returns {{label: string|null, text: string} | null}
 */
export function pickOption(options, raw) {
  const s = norm(raw);
  if (s === '' || !Array.isArray(options)) return null;
  const items = options.map((o) => ({ label: optionLabel(o), text: optionText(o) }));
  const full = items.filter((i) => norm(i.text) === s);
  if (full.length === 1) return full[0];
  const byLabel = items.filter((i) => i.label != null && norm(i.label) === s);
  return byLabel.length === 1 ? byLabel[0] : null;
}

/**
 * choice 缺省或 'default' → 协议 default；其余必须命中选项，否则 400。
 * default 对不上任何选项时原样作为所选（到期默认不因协议小瑕疵卡死）。
 * @returns {{choice: string, chosen_option: string}}
 */
export function resolveChoice(detail, choice) {
  const useDefault = choice == null || String(choice).trim() === '' || norm(choice) === 'default';
  if (useDefault) {
    const def = detail?.default;
    const hit = pickOption(detail?.options, def);
    if (hit) return { choice: hit.label ?? hit.text, chosen_option: hit.text };
    return { choice: String(def), chosen_option: String(def) };
  }
  const hit = pickOption(detail?.options, choice);
  if (!hit) {
    throw new OwnerDecisionResolveError(
      `未知选项 ${JSON.stringify(choice)}；可选：${(detail?.options ?? []).map(optionText).join(' | ')}`,
      { status: 400, code: 'owner_decision_unknown_choice' },
    );
  }
  return { choice: hit.label ?? hit.text, chosen_option: hit.text };
}

/**
 * 到期时刻（epoch ms）= deadline 与 blocked_until 中较晚者：不在主理人声明的截止前提前执行默认；
 * 不可逆顺延 blocked_until 后，同一任务也不会每轮重复处理。deadline 不可解析 → null。
 */
export function computeDueAt(detail, blockedUntil) {
  const dl = Date.parse(detail?.deadline);
  if (Number.isNaN(dl)) return null;
  const bu = blockedUntil ? new Date(blockedUntil).getTime() : NaN;
  return Number.isNaN(bu) ? dl : Math.max(dl, bu);
}

function parseJson(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v ?? null;
}

async function lockBlockedOwnerDecision(db, taskId) {
  const { rows } = await db.query(
    `SELECT id, title, status, blocked_reason, blocked_detail, blocked_until, payload
       FROM tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  const task = rows[0];
  if (!task) throw new OwnerDecisionResolveError(`任务 ${taskId} 不存在`, { status: 404, code: 'owner_decision_task_not_found' });
  if (task.status !== 'blocked' || task.blocked_reason !== OWNER_DECISION_REASON) {
    throw new OwnerDecisionResolveError(
      `任务 ${taskId} 已不在等待决策（status=${task.status}, blocked_reason=${task.blocked_reason ?? 'null'}）`,
      { status: 409, code: 'owner_decision_not_waiting' },
    );
  }
  return { ...task, blocked_detail: parseJson(task.blocked_detail) ?? {}, payload: parseJson(task.payload) ?? {} };
}

/** 协议快照 + 已有留痕合并（blocked_detail 会被 unblock 清空，所以快照必须留在 payload）。 */
function snapshotOf(task, extra) {
  const d = task.blocked_detail;
  return {
    ...(task.payload.owner_decision ?? {}),
    question: d.question,
    options: d.options,
    default: d.default,
    deadline: d.deadline,
    reversible: d.reversible,
    waiting_on: d.waiting_on,
    ...extra,
  };
}

async function writeOwnerDecisionPayload(db, taskId, ownerDecision) {
  await db.query(
    `UPDATE tasks
        SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{owner_decision}', $2::jsonb, true),
            updated_at = NOW()
      WHERE id = $1`,
    [taskId, JSON.stringify(ownerDecision)],
  );
}

/**
 * 应用一次决议：写回 payload.owner_decision.resolution → 关待办 → unblockTask 回 queued → 写 decisions。
 * 批准（via=approve, by=reviewer）与到期默认（via=default_on_deadline, by=system）走同一条路径。
 *
 * @param {{query: Function}} db 事务内的 client
 * @param {{taskId: string, choice?: string|null, by: string, via: string, pendingActionId?: string|null}} p
 * @returns {Promise<{task_id: string, resolution: object, decision_id: string, pending_action_id: string|null}>}
 * @throws {OwnerDecisionResolveError} 400 未知选项/machine 型；404 任务不存在；409 任务已不在等待或解阻塞被拦
 */
export async function applyOwnerDecisionResolution(db, { taskId, choice = null, by, via, pendingActionId = null }) {
  const task = await lockBlockedOwnerDecision(db, taskId);
  const detail = task.blocked_detail;
  if (detail.waiting_on !== 'human') {
    throw new OwnerDecisionResolveError(
      `任务 ${taskId} 等的是 ${detail.waiting_on ?? '未知'}（机器），不该有主理人待办，拒绝按待办批准`,
      { status: 400, code: 'owner_decision_not_human' },
    );
  }
  const picked = resolveChoice(detail, choice);
  const at = new Date().toISOString();
  const resolution = { choice: picked.choice, chosen_option: picked.chosen_option, by, at, via };

  await writeOwnerDecisionPayload(db, taskId, snapshotOf(task, { resolution }));

  // 先以真实 reviewer 关待办；unblockTask 内部的「关待办」随后是 no-op（已非 pending_approval）。
  const closed = await db.query(
    `UPDATE pending_actions
        SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), execution_result = $3::jsonb
      WHERE signature = $1 AND status = 'pending_approval'
      RETURNING id`,
    [ownerDecisionSignature(taskId), by, JSON.stringify({ owner_decision: resolution })],
  );
  const paId = pendingActionId ?? closed.rows[0]?.id ?? null;

  const unblocked = await unblockTask(taskId, { db });
  if (!unblocked.success) {
    throw new OwnerDecisionResolveError(`任务 ${taskId} 放回队列失败：${unblocked.error}`, {
      status: 409,
      code: 'owner_decision_unblock_failed',
    });
  }

  const byDefault = via === RESOLUTION_VIA.DEFAULT_ON_DEADLINE;
  const reason = byDefault
    ? `主理人未在截止前应答，按可逆默认执行，可推翻。来源任务 ${taskId}；pending_action ${paId ?? '无'}；截止 ${detail.deadline}`
    : `来源任务 ${taskId}；pending_action ${paId ?? '无'}；主理人 ${by} 经待办批准`;
  const dec = await db.query(
    `INSERT INTO decisions (category, topic, decision, reason, status, made_by, author, decided_at, source_ref)
     VALUES ('decision', $1, $2, $3, 'active', $4, $5, NOW(), $6) RETURNING id`,
    [
      String(detail.question).slice(0, 250),
      `选 ${picked.choice}：${picked.chosen_option}`,
      reason,
      byDefault ? 'system' : 'user',
      by,
      `owner_decision:${taskId}:${at}`,
    ],
  );

  return { task_id: taskId, resolution, decision_id: dec.rows[0].id, pending_action_id: paId };
}

/**
 * 驳回：任务保持 blocked，只把「主理人明确驳回」写进 payload（sweeper 据此不再用默认覆盖）。
 * 待办本身由调用方（rejectPendingAction）置 rejected。非 owner_decision 任务/已不在等待 → 静默返回 {recorded:false}，
 * 不因任务侧状态漂移而阻止驳回待办。
 */
export async function recordOwnerDecisionRejection(db, { taskId, by, reason = '' }) {
  const { rows } = await db.query(
    `SELECT id, status, blocked_reason, blocked_detail, payload FROM tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  const t = rows[0];
  if (!t || t.status !== 'blocked' || t.blocked_reason !== OWNER_DECISION_REASON) return { recorded: false };
  const task = { ...t, blocked_detail: parseJson(t.blocked_detail) ?? {}, payload: parseJson(t.payload) ?? {} };
  const resolution = { choice: null, by, at: new Date().toISOString(), via: RESOLUTION_VIA.REJECT, reason };
  await writeOwnerDecisionPayload(db, taskId, snapshotOf(task, { resolution }));
  return { recorded: true, resolution };
}
