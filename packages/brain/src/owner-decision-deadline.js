/**
 * owner-decision-deadline — 「到期不答按默认走」的执行者（决策 105a5868 三档协议，链 bf5088a3 棒 9，任务 8aa79219）。
 *
 * 协议承诺：blocked_reason='owner_decision' 的任务到 deadline 主理人还没应答，就按 default 走。
 * 此前没有任何代码兑现这句话（棒 5 只落了协议与待办）。本 job 约每 10 分钟一轮：
 *
 *   waiting_on=human 且已到期的 blocked owner_decision 任务：
 *     reversible=true 且有 default → 与「批准」同一个内部函数应用默认（via=default_on_deadline, by=system），
 *                                    写 decisions（made_by=system），Bark P2「已按默认 X 执行，想推翻回复」。
 *     reversible=false 或无 default → 不自动执行：blocked_until 顺延 24h + payload 留痕次数 + 待办 expires_at 同步顺延，
 *                                    Bark P1 再催一次。既不静默永卡，也不让不可逆动作自己走。
 *
 * 到期时刻 = max(deadline, blocked_until)：不在主理人声明的截止前提前执行；顺延抬高 blocked_until 后，同一任务不会每轮重复处理。
 * 主理人已驳回（payload...resolution.via=reject）的不被默认覆盖。
 *
 * 有界（09-24 notion-gtd-sync 卡死 8.4h 的教训，docs/superpowers/specs/2026-09-24-scheduler-jobs-ops-cockpit-liveness-design.md）：
 *   每条 SQL query_timeout；每任务独立事务并 SET LOCAL statement_timeout/lock_timeout；取连接带超时；
 *   整轮时间预算，超出即停（下一轮续）；Bark 带超时且失败不影响已提交的结果；单任务失败不影响其余。
 *
 * 幂等：每任务事务内 FOR UPDATE 复核仍 blocked 且仍到期才动手；成功后任务已 queued / blocked_until 已抬高，下一轮自然不再命中。
 */
import { applyOwnerDecisionResolution, computeDueAt, RESOLUTION_VIA, OwnerDecisionResolveError } from './lib/owner-decision-resolve.js';
import { OWNER_DECISION_REASON, ownerDecisionSignature } from './lib/owner-decision.js';
import { sendBark as defaultBark } from './notifier.js';

const INTERVAL_MS = parseInt(process.env.CECELIA_OWNER_DECISION_DEADLINE_INTERVAL_MS || String(10 * 60 * 1000), 10);
export const DEFER_MS = 24 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const BARK_TIMEOUT_MS = 15_000;
const ROUND_BUDGET_MS = 90_000;
const BATCH_LIMIT = 50;
const BARK_DEDUPE_TTL_SEC = 7 * 24 * 3600;

let lastRunAt = 0;
export function __resetOwnerDecisionDeadlineForTest() { lastRunAt = 0; }

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function acquireClient(pool) {
  const pending = pool.connect();
  try {
    return await withTimeout(pending, CONNECT_TIMEOUT_MS, 'pool.connect');
  } catch (err) {
    // 超时后才拿到的连接必须还回去，否则泄漏
    pending.then((c) => c.release()).catch(() => {});
    throw err;
  }
}

const parseJson = (v) => {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v ?? null;
};

/** 单任务事务：BEGIN → 设超时 → 行锁复核仍到期 → fn(client, fresh) → COMMIT；任何异常 ROLLBACK 后上抛。 */
async function inTaskTransaction(pool, taskId, nowMs, fn) {
  const client = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '15s'`);
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    const { rows } = await client.query(
      `SELECT id, title, status, blocked_reason, blocked_detail, blocked_until, payload FROM tasks WHERE id = $1 FOR UPDATE`,
      [taskId],
    );
    const t = rows[0];
    const detail = parseJson(t?.blocked_detail) ?? {};
    const payload = parseJson(t?.payload) ?? {};
    const due = computeDueAt(detail, t?.blocked_until);
    const stillDue =
      t && t.status === 'blocked' && t.blocked_reason === OWNER_DECISION_REASON && detail.waiting_on === 'human' &&
      due != null && due <= nowMs && payload.owner_decision?.resolution?.via !== RESOLUTION_VIA.REJECT;
    if (!stillDue) {
      await client.query('ROLLBACK');
      return { skipped: true };
    }
    const out = await fn(client, { task: t, detail, payload });
    await client.query('COMMIT');
    return { skipped: false, ...out };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function safeBark(bark, title, body, opts) {
  try {
    return await withTimeout(Promise.resolve(bark(title, body, opts)), BARK_TIMEOUT_MS, 'bark');
  } catch (err) {
    console.warn('[owner-decision-deadline] Bark 失败（不影响已提交的结果）:', err.message);
    return false;
  }
}

async function applyDefault(pool, row, { bark, nowMs }) {
  const r = await inTaskTransaction(pool, row.id, nowMs, async (client) => {
    const res = await applyOwnerDecisionResolution(client, {
      taskId: row.id,
      choice: null, // 缺省 → 协议 default
      by: 'system',
      via: RESOLUTION_VIA.DEFAULT_ON_DEADLINE,
    });
    return { resolution: res.resolution };
  });
  if (r.skipped) return { outcome: 'skipped' };
  const { choice, chosen_option: chosen } = r.resolution;
  await safeBark(
    bark,
    '【P2】决策到期，已按默认执行',
    `「${row.question}」主理人未在截止前应答，已按默认 ${choice}（${chosen}）执行，该决策可逆。想推翻请回复。任务：${row.title ?? row.id}`,
    { dedupeKey: `owner_decision_default_${row.id}`, dedupeTtlSec: BARK_DEDUPE_TTL_SEC },
  );
  return { outcome: 'applied' };
}

async function deferIrreversible(pool, row, { bark, nowMs }) {
  const r = await inTaskTransaction(pool, row.id, nowMs, async (client, { payload }) => {
    const prev = payload.owner_decision?.deadline_deferrals?.count ?? 0;
    const count = prev + 1;
    const nextDue = new Date(nowMs + DEFER_MS);
    const ownerDecision = {
      ...(payload.owner_decision ?? {}),
      deadline_deferrals: { count, last_at: new Date(nowMs).toISOString(), next_due_at: nextDue.toISOString() },
    };
    await client.query(
      `UPDATE tasks
          SET blocked_until = $2,
              payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{owner_decision}', $3::jsonb, true),
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, nextDue.toISOString(), JSON.stringify(ownerDecision)],
    );
    // 待办也顺延：owner_decision 待办虽不按时间过期，expires_at 仍要如实反映当前的截止
    // expires_at 是 timestamp without time zone：显式 ::timestamptz 让 PG 按会话时区换算，与 NOW() 同口径
    await client.query(
      `UPDATE pending_actions SET expires_at = $2::timestamptz WHERE signature = $1 AND status = 'pending_approval'`,
      [ownerDecisionSignature(row.id), nextDue.toISOString()],
    );
    return { count };
  });
  if (r.skipped) return { outcome: 'skipped' };
  await safeBark(
    bark,
    '【P1】不可逆决策已过截止，仍等你拍板',
    `「${row.question}」已过截止但该决策不可逆，不会自动执行；已顺延 24h（第 ${r.count} 次）。请在待办里选择（默认建议 ${row.defaultLabel}）。任务：${row.title ?? row.id}`,
    { dedupeKey: `owner_decision_deferred_${row.id}_${r.count}`, dedupeTtlSec: BARK_DEDUPE_TTL_SEC },
  );
  return { outcome: 'deferred' };
}

/**
 * scheduler-jobs handler。
 * @param {{query: Function, connect: Function}} pool
 * @param {{bark?: Function, force?: boolean, now?: number, budgetMs?: number}} [opts] 供测试注入
 */
export async function runOwnerDecisionDeadline(pool, opts = {}) {
  const { bark = defaultBark, force = false, now = Date.now(), budgetMs = ROUND_BUDGET_MS } = opts;
  if (!force && now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  const started = Date.now();
  const summary = { examined: 0, applied: 0, deferred: 0, notDue: 0, skipped: 0, failed: 0, budgetExceeded: false };

  // SQL 预筛：blocked_until 还在未来的一定没到期（due = max(deadline, blocked_until)）；已驳回的不碰。
  const { rows } = await pool.query({
    text: `SELECT id, title, blocked_detail, blocked_until
             FROM tasks
            WHERE status = 'blocked'
              AND blocked_reason = 'owner_decision'
              AND blocked_detail->>'waiting_on' = 'human'
              AND (blocked_until IS NULL OR blocked_until < NOW())
              AND COALESCE(payload->'owner_decision'->'resolution'->>'via', '') <> 'reject'
            ORDER BY blocked_until NULLS FIRST
            LIMIT $1`,
    values: [BATCH_LIMIT],
    query_timeout: QUERY_TIMEOUT_MS,
  });

  for (const r of rows) {
    if (Date.now() - started > budgetMs) { summary.budgetExceeded = true; break; }
    summary.examined += 1;
    const detail = parseJson(r.blocked_detail) ?? {};
    const due = computeDueAt(detail, r.blocked_until);
    if (due == null || due > now) { summary.notDue += 1; continue; }

    const hasDefault = detail.default != null && String(detail.default).trim() !== '';
    const row = { id: r.id, title: r.title, question: detail.question, defaultLabel: detail.default };
    try {
      const res = detail.reversible === true && hasDefault
        ? await applyDefault(pool, row, { bark, nowMs: now })
        : await deferIrreversible(pool, row, { bark, nowMs: now });
      if (res.outcome === 'applied') summary.applied += 1;
      else if (res.outcome === 'deferred') summary.deferred += 1;
      else summary.skipped += 1;
    } catch (err) {
      // 任务被别处同时放行 → 不算失败；其余记失败，下一轮重试，不拖垮整轮
      if (err instanceof OwnerDecisionResolveError && err.code === 'owner_decision_not_waiting') summary.skipped += 1;
      else {
        summary.failed += 1;
        console.warn(`[owner-decision-deadline] 任务 ${r.id} 处理失败:`, err.message);
      }
    }
  }

  if (summary.applied + summary.deferred + summary.failed > 0) {
    console.log('[owner-decision-deadline]', JSON.stringify(summary));
  }
  return summary;
}
