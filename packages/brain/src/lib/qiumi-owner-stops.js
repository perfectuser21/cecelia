import { blockTask, unblockTask } from '../task-updater.js';
import { recordProjectionCommand } from '../projection/commands.js';
import { toStartIso, toEndIso, sameInstant, isFuture } from './qiumi-schedule.js';

export const OWNER_STOP_FILTERS = Object.freeze(['淘汰', '阻塞', '委派'].map((s) => Object.freeze({
  and: [
    { property: '状态', status: { equals: s } },
    { property: 'OpenClaw任务号', rich_text: { starts_with: 'brain:' } },
  ],
})));

const taskIdOf = (page) => page.taskNo.match(/brain:([0-9a-f-]{36})/)?.[1] ?? null;

/** 已解析中文页 → Brain 急停、恢复与改期；Notion IO 留在入口模块。 */
export async function applyOwnerChanges(pool, [discarded, holds, redelegated], { now }) {
  let cancelled = 0; let held = 0; let resumed = 0; let rescheduled = 0;
  const ignored = [];
  for (const page of discarded) {
    const id = taskIdOf(page);
    if (!id) continue;
    // 固定命令键：编辑时间不能进幂等键，否则页面每次编辑都会给终态新增死命令。
    await recordProjectionCommand(pool, {
      target: 'notion', externalId: `${page.id}:cancel_requested`, entityType: 'tasks',
      entityId: id, commandType: 'cancel_requested', payload: { source: 'qiumi_owner_stop' },
    });
    cancelled += 1;
  }
  for (const page of holds) {
    const id = taskIdOf(page);
    if (!id) continue;
    const r = await blockTask(id, { reason: 'owner_hold', detail: '主理人在中文表拖到阻塞' });
    if (r?.success) { held += 1; continue; }
    const reason = r?.error || 'block_failed';
    ignored.push({ id, action: 'hold', reason });
    console.warn(`[notion-gtd-sync] 急停未生效 task=${id} action=hold reason=${reason}`);
  }
  for (const page of redelegated) {
    const id = taskIdOf(page);
    if (!id) continue;
    const { rows } = await pool.query(
      "SELECT id, status, blocked_reason, due_at, payload->>'scheduled_start' AS scheduled_start FROM tasks WHERE id=$1", [id],
    );
    const t = rows[0];
    if (t?.status === 'queued') {
      const start = toStartIso(page.startAt);
      const end = toEndIso(page.endAt);
      // 只比上次 Notion 开始时间，不比 next_run_at：后者还承载失败/手机忙退避。
      // 存量无 scheduled_start 的过去开始时间不接管退避，但截止编辑始终独立生效。
      const startChanged = !sameInstant(start, t.scheduled_start)
        && Boolean(t.scheduled_start || isFuture(start, now()));
      const endChanged = !sameInstant(end, t.due_at);
      if (startChanged || endChanged) {
        const updated = await pool.query(
          `UPDATE tasks SET payload = CASE WHEN $3::boolean THEN COALESCE(payload,'{}'::jsonb)
                    || jsonb_build_object('next_run_at', $2::text, 'scheduled_start', $2::text)
                    ELSE payload END,
                  due_at = CASE WHEN $5::boolean THEN ($4::timestamptz AT TIME ZONE 'UTC') ELSE due_at END,
                  notion_props = COALESCE(notion_props,'{}'::jsonb) - 'qiumi_pushed_status', updated_at = NOW()
            WHERE id = $1 AND status = 'queued' AND task_type = 'qiumi_task'
              AND payload->>'notion_zh_page_id' = $6
            RETURNING id`,
          [id, start ?? '', startChanged, end, endChanged, page.id],
        );
        if (updated.rows.length) rescheduled += 1;
      }
      continue;
    }
    if (t?.status === 'blocked' && t.blocked_reason === 'owner_hold') {
      const r = await unblockTask(id);
      if (r?.success) { resumed += 1; continue; }
      const reason = r?.error || 'unblock_failed';
      ignored.push({ id, action: 'resume', reason });
      console.warn(`[notion-gtd-sync] 急停未生效 task=${id} action=resume reason=${reason}`);
    }
  }
  return { cancelled, held, resumed, rescheduled, ignored };
}
