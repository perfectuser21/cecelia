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
 * 累计等待超过 min(任务超时, 120 分钟) 或已过 payload.expires_at → failed(device_busy_timeout)。
 */

export const DEVICE_BUSY_RETRY_MS = 5 * 60 * 1000;
export const DEVICE_BUSY_MAX_WAIT_MS = 120 * 60 * 1000;
export const DEVICE_BUSY_TIMEOUT_REASON = 'device_busy_timeout';

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
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 回队还是判超时（纯函数）。
 * @param {{payload?: object, marker: {owner, serial}, timeoutSec: number, now: number}} input
 * @returns {{action: 'requeue'|'timeout', attempts: number, nextRunAt: string|null, deviceBusy: object, waitedMs: number, budgetMs: number}}
 */
export function planDeviceBusy({ payload = {}, marker, timeoutSec, now }) {
  const prev = payload.device_busy ?? {};
  const attempts = (Number(payload.device_busy_attempts) || 0) + 1;
  const firstMs = parseTime(prev.first_at) ?? now;
  const waitedMs = Math.max(0, now - firstMs);
  const budgetMs = Math.min(Math.max(0, Number(timeoutSec) || 0) * 1000, DEVICE_BUSY_MAX_WAIT_MS);
  const expiresMs = parseTime(payload.expires_at);
  const expired = expiresMs != null && now >= expiresMs;
  const timeout = expired || waitedMs >= budgetMs;
  const nextRunAt = timeout ? null : new Date(now + DEVICE_BUSY_RETRY_MS).toISOString();
  const deviceBusy = {
    owner: marker?.owner ?? null,
    serial: marker?.serial ?? null,
    first_at: new Date(firstMs).toISOString(),
    last_at: new Date(now).toISOString(),
    attempts,
    next_run_at: nextRunAt,
  };
  return { action: timeout ? 'timeout' : 'requeue', attempts, nextRunAt, deviceBusy, waitedMs, budgetMs, expired };
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
