/**
 * 秋米派单同机串行闸（任务 5ad81457）。
 *
 * 一台手机同一时刻只能有一张秋米任务在跑：两张单同时落到同一台手机，后到的必然拿不到
 * douyin-phone-adb 本机文件锁（0930 09:15 小彩实证）。Brain 看得见自己派出去的 in_progress，
 * 就在派单前先挡掉——看不见的（采收/触达 cron 持锁）靠 agent 回报 DEVICE_BUSY 由收割器回队兜底。
 *
 * 只数 qiumi_task + in_progress，口径与并发闸 / 收割器一致。
 */
import { recordTaskEventSafe } from '../lib/task-event-log.js';

/** 路由留痕里的手机序列号；非设备活没有 serial → null（不进闸）。 */
export function routeSerialOf(payload) {
  const s = payload?.qiumi_route?.device_hint?.serial;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

// task_events 去重：同一张单被同一张占用单挡住，每个 tick 都记一笔会刷屏；换了占用者才再记。
// 进程内状态，重启后最多多记一笔。
const lastLogged = new Map();
const LAST_LOGGED_MAX = 500;

/**
 * 同一台手机上已有别的秋米任务在跑？是 → 返回占用那张单（并记 task_events），否 → null。
 * @returns {Promise<{id: string}|null>}
 */
export async function findSameSerialBusy(pool, taskId, serial) {
  if (!serial) return null;
  const { rows } = await pool.query(
    `SELECT id, started_at FROM tasks
      WHERE task_type = 'qiumi_task' AND status = 'in_progress' AND id <> $1
        AND payload->'qiumi_route'->'device_hint'->>'serial' = $2
      ORDER BY started_at ASC NULLS FIRST
      LIMIT 1`,
    [taskId, serial],
  );
  const busy = rows?.[0] ?? null;
  if (!busy) {
    lastLogged.delete(taskId);
    return null;
  }
  if (lastLogged.get(taskId) !== busy.id) {
    if (lastLogged.size >= LAST_LOGGED_MAX) lastLogged.clear();
    lastLogged.set(taskId, busy.id);
    await recordTaskEventSafe(pool, taskId, 'qiumi_dispatch_device_busy', { serial, busy_task_id: busy.id });
  }
  return busy;
}
