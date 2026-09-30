/**
 * 秋米任务「手机忙」排队等待（任务 5ad81457）。
 *
 * 0930 09:15 实证：苏彦卿任务 160d1a2a（小彩）派出时，小彩正被另一张秋米任务持锁；agent 拿不到
 * 手机锁、按技能不抢锁直接收尾报「受阻」，收割器照单判 completed_no_pr——活没干，账却销了。
 * 手机锁是西安 Mac 本机文件锁（douyin-phone-adb lock-acquire），采收/触达 cron 也会持锁，
 * Brain 看不到，只能靠 agent 回报。
 *
 * 约定（douyin-phone-runtime skill + executor prompt 两头同一口径）：拿不到锁时最后一行只输出
 *   DEVICE_BUSY owner=<锁持有者> serial=<序列号>
 * 收割器见到它：不判终态 → 回 queued、清 run_id（保留路由）、next_run_at=now+5min、attempts+1；
 * 到截止时间仍忙 → failed(device_busy_expired，过期未执行)。
 *
 * 截止时间（等待上限）：payload.expires_at → tasks.due_at（中文表「预期结束时间」入账落这里，
 * notion-push-sync.js ingestQiumiPage）→ 都没有则首次忙起 24 小时。
 * 不参考执行超时（timeout_sec）：排队时任务还没开始执行，执行超时只管真正跑起来的那次 run
 * （executor 每次派发都把完整 timeout_sec 传给 openclaw agent --timeout，与排队多久无关）。
 */

export const DEVICE_BUSY_RETRY_MS = 5 * 60 * 1000;
export const DEVICE_BUSY_DEFAULT_WAIT_MS = 24 * 60 * 60 * 1000;
export const DEVICE_BUSY_EXPIRED_REASON = 'device_busy_expired';

/**
 * 收割器取 due_at 的 SQL 表达式。任务 19684870：db.js 全局 setTypeParser 已经把
 * timestamp without time zone 列的读取修正为按 UTC 解析（tasks.due_at 现在也统一存
 * 真实 UTC 时刻，见 notion-push-sync.js ingestQiumiPage），不再需要这层 SQL 补偿，
 * 直接读原列即可。保留这个符号名只是为了不用改所有调用点的写法。
 */
export const DUE_AT_SELECT_SQL = 'due_at';

// 行首（允许反引号/星号/空白包裹）才算标记；正文里顺嘴提到 DEVICE_BUSY 不算。
const MARKER_LINE = /^[\s`*>]*DEVICE_BUSY\b([^\n]*)$/gm;

function fieldOf(rest, key) {
  const m = rest.match(new RegExp(`(?:^|\\s)${key}=([^\\s\`*]+)`));
  return m ? m[1] : null;
}

/**
 * 从 agent 最终可见文本里取 DEVICE_BUSY 标记行（多行时取最后一行）。
 * @returns {{owner: string|null, serial: string|null} | null}
 */
export function parseDeviceBusyMarker(text) {
  if (typeof text !== 'string' || !text.includes('DEVICE_BUSY')) return null;
  const all = [...text.matchAll(MARKER_LINE)];
  if (!all.length) return null;
  const rest = all[all.length - 1][1];
  return { owner: fieldOf(rest, 'owner'), serial: fieldOf(rest, 'serial') };
}

function parseTime(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 截止时间：expires_at → due_at → 首次忙起 24 小时。
 * due_at 不晚于排期开始时间（payload.scheduled_start）不算截止：存量行入账时曾把开始时间误落 due_at，
 * 拿它当截止会让任务一忙就判过期。
 */
function deadlineOf(payload, dueAt, firstMs) {
  const expiresMs = parseTime(payload.expires_at);
  if (expiresMs != null) return { ms: expiresMs, source: 'expires_at' };
  const dueMs = parseTime(dueAt);
  const startMs = parseTime(payload.scheduled_start);
  if (dueMs != null && (startMs == null || dueMs > startMs)) return { ms: dueMs, source: 'due_at' };
  return { ms: firstMs + DEVICE_BUSY_DEFAULT_WAIT_MS, source: 'default_24h' };
}

/**
 * 回队还是判过期（纯函数）。不收执行超时参数——排队等待与执行超时无关。
 * @param {{payload?: object, marker: {owner, serial}, dueAt?: string|Date|null, now: number}} input  dueAt = tasks.due_at
 * @returns {{action: 'requeue'|'expired', attempts: number, nextRunAt: string|null, deviceBusy: object,
 *   waitedMs: number, deadlineAt: string, deadlineSource: 'expires_at'|'due_at'|'default_24h'}}
 */
export function planDeviceBusy({ payload = {}, marker, dueAt = null, now }) {
  const prev = payload.device_busy ?? {};
  const attempts = (Number(payload.device_busy_attempts) || 0) + 1;
  const firstMs = parseTime(prev.first_at) ?? now;
  const waitedMs = Math.max(0, now - firstMs);
  const deadline = deadlineOf(payload, dueAt, firstMs);
  const expired = now >= deadline.ms;
  const nextRunAt = expired ? null : new Date(now + DEVICE_BUSY_RETRY_MS).toISOString();
  const deadlineAt = new Date(deadline.ms).toISOString();
  const deviceBusy = {
    owner: marker?.owner ?? null,
    serial: marker?.serial ?? null,
    first_at: new Date(firstMs).toISOString(),
    last_at: new Date(now).toISOString(),
    attempts,
    next_run_at: nextRunAt,
    deadline_at: deadlineAt,
    deadline_source: deadline.source,
  };
  return {
    action: expired ? 'expired' : 'requeue', attempts, nextRunAt, deviceBusy, waitedMs,
    deadlineAt, deadlineSource: deadline.source,
  };
}

/**
 * 回队：in_progress → queued，清 run_id（下一轮换新 run_id，远端 ALREADY 探针才不会认成已跑完），
 * 路由（qiumi_route）原样保留；status_history 记一笔。CAS in_progress：别的通道先结过账就不动。
 * 清中文表回写指纹：两次忙之间 in_progress 可能短到没被回写扫到，指纹停在 queued，
 * 第 N 次的「⏳ 手机忙…」提示就刷不上去。
 * @returns {Promise<boolean>} 是否真的回队
 */
export async function requeueForDeviceBusy(pool, taskId, plan, runId) {
  const patch = {
    next_run_at: plan.nextRunAt,
    device_busy_attempts: plan.attempts,
    device_busy: { ...plan.deviceBusy, last_run_id: runId ?? null },
  };
  const history = {
    from: 'in_progress', to: 'queued', source: 'device_busy',
    owner: plan.deviceBusy.owner, attempt: plan.attempts, next_run_at: plan.nextRunAt,
  };
  const r = await pool.query(
    `UPDATE tasks
        SET status = 'queued', claimed_by = NULL, claimed_at = NULL, started_at = NULL,
            payload = (COALESCE(payload, '{}'::jsonb) - 'run_id') || $2::jsonb,
            status_history = COALESCE(status_history, '[]'::jsonb)
              || jsonb_build_array($3::jsonb || jsonb_build_object('changed_at', NOW())),
            notion_props = COALESCE(notion_props, '{}'::jsonb) - 'qiumi_pushed_status',
            updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress'`,
    [taskId, JSON.stringify(patch), JSON.stringify(history)],
  );
  return (r?.rowCount ?? 0) > 0;
}
