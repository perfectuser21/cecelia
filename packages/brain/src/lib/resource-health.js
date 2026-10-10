/**
 * resource-health.js — 资源健康进仓库（决策 de6dff5d 五块模型第 5 步，任务 5bf2512a）
 *
 * 仓库 warehouse_items 登记「有什么」，本模块管「现在能不能用」：resource_health（迁移 539）
 * 一资源一行当下五态，状态变化历史由库触发器写 resource_health_events。
 *
 * 资源键（不另造设备表）：手机 = serial（同 device_locks / phone_registry），
 * 账号 = <平台>:<账号 id>，仓库物件 = warehouse_items.key。平台通用，不写死任何业务线。
 *
 * 判派规则：offline / restricted 挡派发；degraded、unknown（没记录）、过期的 healthy 只提示不挡
 * ——执行端还没全量上报前，「没记录」若算不健康会把所有任务挡死。
 */

export const HEALTH_STATUSES = Object.freeze(['healthy', 'degraded', 'offline', 'restricted', 'unknown']);
export const BLOCKING_STATUSES = Object.freeze(['offline', 'restricted']);
export const RESOURCE_TYPES = Object.freeze(['account', 'phone', 'machine', 'warehouse_item', 'service', 'other']);
export const DEFAULT_MAX_AGE_HOURS = 24;
const MAX_REFS = 20;
const MAX_EVIDENCE_BYTES = 16 * 1024;
const KEY_RE = /^[^\s\0]{1,200}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 账号键：<平台小写>:<账号 id>；缺一个返回 null。 */
export function accountKey(platform, accountId) {
  const p = str(platform).toLowerCase();
  const a = str(accountId);
  if (!p || !a) return null;
  return `${p}:${a}`;
}

/**
 * 校验并规整一次健康上报。
 * @returns {{report: object}|{error: string}}
 */
export function normalizeHealthReport(body) {
  const b = isPlainObject(body) ? body : {};
  const resourceType = str(b.resource_type);
  if (!RESOURCE_TYPES.includes(resourceType)) return { error: `resource_type 必须是 ${RESOURCE_TYPES.join('/')}` };
  const status = str(b.status);
  if (!HEALTH_STATUSES.includes(status)) return { error: `status 必须是 ${HEALTH_STATUSES.join('/')}` };

  const platform = str(b.platform) ? str(b.platform).toLowerCase() : null;
  const rawKey = typeof b.resource_key === 'string' ? b.resource_key : '';
  let resourceKey = rawKey.trim() === rawKey ? rawKey : '';
  if (!resourceKey && resourceType === 'account' && rawKey === '') resourceKey = accountKey(b.platform, b.account_id) ?? '';
  if (!KEY_RE.test(resourceKey)) return { error: 'resource_key 必填（1-200 字符、无空白；账号可改传 platform + account_id）' };

  const source = str(b.source);
  if (!source || source.length > 100) return { error: 'source 必填（谁观测到的，≤100 字符）' };

  const reason = b.reason == null ? null : String(b.reason).slice(0, 500);
  if (BLOCKING_STATUSES.includes(status) || status === 'degraded') {
    if (!reason || !reason.trim()) return { error: `status=${status} 必须带 reason` };
  }

  const evidence = b.evidence === undefined || b.evidence === null ? {} : b.evidence;
  if (!isPlainObject(evidence)) return { error: 'evidence 必须是对象' };
  if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_EVIDENCE_BYTES) return { error: `evidence 超过 ${MAX_EVIDENCE_BYTES} 字节，大文件请传链接` };

  let reportedAt = null;
  if (b.reported_at != null) {
    const d = new Date(b.reported_at);
    if (Number.isNaN(d.getTime())) return { error: 'reported_at 不是合法时间' };
    reportedAt = d.toISOString();
  }
  const itemKey = str(b.item_key) || null;

  return {
    report: {
      resource_type: resourceType, resource_key: resourceKey, platform, status,
      reason, evidence, source, item_key: itemKey, reported_at: reportedAt,
    },
  };
}

/**
 * 账号切换三态判据（主理人定的规矩，适用于任何平台的账号切换）：
 *   切换列表里账号消失         = offline（掉线）       → 停用该号
 *   切换要身份校验 / 人脸        = restricted（被风控） → 立即退出，不做验证
 *   切换成功可用               = healthy              → 继续
 * 没见过的结果不猜，返回 null（由调用方拒收）。
 */
const SWITCH_RULES = Object.freeze({
  switched: { status: 'healthy', action: 'proceed', reason: '账号切换成功可用' },
  list_missing: { status: 'offline', action: 'stop_using_account', reason: '账号切换列表里该账号消失（掉线）' },
  verification_required: { status: 'restricted', action: 'exit_without_verification', reason: '切换账号要求身份校验（被风控）' },
  face_verification: { status: 'restricted', action: 'exit_without_verification', reason: '切换账号要求人脸验证（被风控）' },
});
export const ACCOUNT_SWITCH_OUTCOMES = Object.freeze(Object.keys(SWITCH_RULES));

export function classifyAccountSwitch(outcome) {
  const rule = SWITCH_RULES[str(outcome)];
  return rule ? { ...rule } : null;
}

function pushRef(out, seen, type, key) {
  const k = str(key);
  if (!RESOURCE_TYPES.includes(type) || !KEY_RE.test(k)) return;
  const id = `${type}\u0000${k}`;
  if (seen.has(id) || out.length >= MAX_REFS) return;
  seen.add(id);
  out.push({ type, key: k });
}

/**
 * 从任务 payload 收集它要用到的资源：device_serial / 秋米路由定下的手机 / account_ref / resource_refs。
 * 没有引用任何资源 → 空数组（调用方据此跳过查库）。
 */
export function collectTaskResourceRefs(payload) {
  if (!isPlainObject(payload)) return [];
  const out = [];
  const seen = new Set();
  pushRef(out, seen, 'phone', payload.device_serial);
  pushRef(out, seen, 'phone', payload.qiumi_route?.device_hint?.serial);
  const acc = payload.account_ref;
  if (typeof acc === 'string') pushRef(out, seen, 'account', acc.includes(':') ? acc : null);
  else if (isPlainObject(acc)) pushRef(out, seen, 'account', accountKey(acc.platform, acc.account_id));
  if (Array.isArray(payload.resource_refs)) {
    for (const r of payload.resource_refs) {
      if (!isPlainObject(r)) continue;
      pushRef(out, seen, str(r.type ?? r.resource_type), r.key ?? r.resource_key);
    }
  }
  return out;
}

const UPSERT_SQL = `
WITH prev AS (
  SELECT status FROM resource_health WHERE resource_type = $1 AND resource_key = $2
), up AS (
  INSERT INTO resource_health
    (resource_type, resource_key, warehouse_item_id, platform, status, reason, evidence, source, observed_at, reported_at, status_since)
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), $9, now())
  ON CONFLICT (resource_type, resource_key) DO UPDATE SET
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    evidence = EXCLUDED.evidence,
    source = EXCLUDED.source,
    observed_at = now(),
    reported_at = EXCLUDED.reported_at,
    platform = COALESCE(EXCLUDED.platform, resource_health.platform),
    warehouse_item_id = COALESCE(EXCLUDED.warehouse_item_id, resource_health.warehouse_item_id)
  RETURNING *
)
SELECT up.*, (SELECT status FROM prev) AS previous_status FROM up`;

/** 仓库物件 id：显式 item_key 优先；resource_type=warehouse_item 时用 resource_key 本身（查不到不报错）。 */
async function resolveItemId(pool, report) {
  const explicit = report.item_key;
  const key = explicit ?? (report.resource_type === 'warehouse_item' ? report.resource_key : null);
  if (!key) return null;
  const { rows } = await pool.query('SELECT id FROM warehouse_items WHERE key = $1', [key]);
  if (!rows[0] && explicit) throw Object.assign(new Error(`unknown_item_key: ${explicit}`), { code: 'unknown_item_key' });
  return rows[0]?.id ?? null;
}

/**
 * 写一次健康观测（已规整的 report）。状态变化 → 异步告警（告警失败只记日志）。
 * @param {{query: Function}} pool
 * @param {object} report normalizeHealthReport 的产物
 * @param {{notify?: (row, previousStatus) => Promise<any>}} [deps]
 * @returns {Promise<{changed: boolean, previous_status: string|null, current: object}>}
 */
export async function reportResourceHealth(pool, report, deps = {}) {
  const itemId = await resolveItemId(pool, report);
  const { rows } = await pool.query(UPSERT_SQL, [
    report.resource_type, report.resource_key, itemId, report.platform ?? null, report.status,
    report.reason ?? null, JSON.stringify(report.evidence ?? {}), report.source, report.reported_at ?? null,
  ]);
  const row = rows[0];
  const previous = row?.previous_status ?? null;
  const changed = previous !== row?.status;
  const { previous_status: _drop, ...current } = row ?? {};
  if (changed && typeof deps.notify === 'function') {
    Promise.resolve()
      .then(() => deps.notify(current, previous))
      .catch((err) => console.error(`[resource-health] 状态变化告警失败（不影响写入） ${current.resource_type}:${current.resource_key}: ${err.message}`));
  }
  return { changed, previous_status: previous, current };
}

/**
 * 调度前检查：这些资源现在能不能用。
 * @returns {Promise<{ok: boolean, blocked: object[], degraded: object[], stale: object[], unknown: object[]}>}
 */
export async function checkResourcesHealth(pool, refs, opts = {}) {
  const list = Array.isArray(refs) ? refs.filter((r) => r && r.type && r.key).slice(0, MAX_REFS) : [];
  const result = { ok: true, blocked: [], degraded: [], stale: [], unknown: [] };
  if (list.length === 0) return result;
  const nowMs = (opts.now ? new Date(opts.now) : new Date()).getTime();
  const maxAgeMs = (opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3600 * 1000;
  const { rows } = await pool.query(
    `SELECT resource_type, resource_key, status, reason, observed_at, status_since, source
       FROM resource_health
      WHERE (resource_type, resource_key) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [list.map((r) => r.type), list.map((r) => r.key)],
  );
  const byId = new Map(rows.map((r) => [`${r.resource_type}\u0000${r.resource_key}`, r]));
  for (const ref of list) {
    const row = byId.get(`${ref.type}\u0000${ref.key}`);
    if (!row || row.status === 'unknown') { result.unknown.push({ type: ref.type, key: ref.key }); continue; }
    const item = { type: ref.type, key: ref.key, status: row.status, reason: row.reason ?? null, observed_at: row.observed_at, source: row.source };
    if (BLOCKING_STATUSES.includes(row.status)) result.blocked.push(item);
    else if (row.status === 'degraded') result.degraded.push(item);
    else if (nowMs - new Date(row.observed_at).getTime() > maxAgeMs) result.stale.push(item);
  }
  result.ok = result.blocked.length === 0;
  return result;
}

/** 一行人话：被挡的资源 + 原因。 */
export function summarizeHealthCheck(check) {
  if (!check?.blocked?.length) return '';
  return check.blocked.map((b) => `${b.type} ${b.key} ${b.status}${b.reason ? `（${b.reason}）` : ''}`).join('；');
}

/** 列当前状态（可按类型/状态过滤）。 */
export async function listResourceHealth(pool, { type = null, status = null, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const { rows } = await pool.query(
    `SELECT h.*, w.key AS warehouse_item_key, w.shelf AS warehouse_shelf
       FROM resource_health h LEFT JOIN warehouse_items w ON w.id = h.warehouse_item_id
      WHERE ($1::text IS NULL OR h.resource_type = $1) AND ($2::text IS NULL OR h.status = $2)
      ORDER BY CASE h.status WHEN 'restricted' THEN 0 WHEN 'offline' THEN 1 WHEN 'degraded' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END,
               h.observed_at DESC
      LIMIT $3`,
    [type, status, lim],
  );
  return rows;
}

/** 某资源的状态变化历史（新→旧）。 */
export async function getResourceHealthHistory(pool, type, key, limit = 100) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await pool.query(
    `SELECT id, from_status, to_status, reason, evidence, source, observed_at, reported_at
       FROM resource_health_events
      WHERE resource_type = $1 AND resource_key = $2
      ORDER BY observed_at DESC, id DESC
      LIMIT $3`,
    [type, key, lim],
  );
  return rows;
}
