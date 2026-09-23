/**
 * device-delegation.js — 秋米设备子任务对账（PR3 补充五）。
 *
 * 为什么存在：设备那一段不是就地把 qiumi_task 改成 device_job——`tasks` 上的
 * `work_routing_task_projection_immutable`（迁移 421）禁止有路由回执的任务改 task_type，
 * 而生产秋米任务全部经 createRoutedTask 入账、必有回执。所以改成派生子任务：
 * 子任务是独立的 device_job（有自己的回执），父任务原地挂
 * `blocked / blocked_reason='delegated_device_job'`。
 *
 * 本模块把子任务的终态回写父任务。它是父任务**唯一**的放行方：
 * 父任务的 `blocked_until` 留 NULL（故意的），`releaseBlockedTasks()` /
 * `unblockExpiredTasks()` 只捞到期的行，捞不到它——那正是为了防止子任务还在跑时
 * 父任务被放回队列派第二遍。代价是这个 job 停了，父任务就永远挂着（runbook 第 4 节有判据）。
 *
 * 写回只动 status / result / error_message / completed_at，**不碰 payload 与 task_type**：
 * 触发器是 `BEFORE UPDATE OF task_type, payload`，不碰就不会把它叫醒。
 *
 * `blocked → completed_no_pr` 与 `blocked → failed` 两条边都已在
 * `lib/task-status-transitions.js` 的 WAITING_EXITS 里（0921 那刀补的），不需要动状态机。
 */
import { recordTaskEventSafe } from '../lib/task-event-log.js';

/** 一轮最多对账多少条父任务。60s 一轮，50 条足够消化四台手机一天约 90 单。 */
const BATCH = 50;

/** 子任务销账态 → 父任务也销账。completed_no_pr 是执行面不产 PR 的销账态（task-type-registry 的 pr:false）。 */
const DONE = new Set(['completed', 'completed_no_pr']);
/** 子任务判死/取消 → 父任务判死。cancelled/canceled 两种拼写生产里都在用，都认。 */
const DEAD = new Set(['failed', 'cancelled', 'canceled']);

// ORDER BY updated_at 而不是 blocked_at：子行丢失的父任务 blocked_at 永不变，按 blocked_at 排
// 它会永远压在前 50 里，把后来的活挡在窗口外（留痕那一步会顺手把 updated_at 推后，让它排到队尾）。
const SCAN_SQL = `
  SELECT id,
         payload->>'device_task_id' AS device_task_id,
         payload->>'qiumi_device_child_missing_at' AS child_missing_at
    FROM tasks
   WHERE task_type = 'qiumi_task'
     AND status = 'blocked'
     AND blocked_reason = 'delegated_device_job'
     AND payload->>'device_task_id' IS NOT NULL
   ORDER BY updated_at ASC
   LIMIT ${BATCH}`;

const CHILD_SQL = 'SELECT id, status, result, error_message FROM tasks WHERE id = $1';

// 两条写回都带 `AND status = 'blocked'` 的 CAS：别人（人工/巡检）已经把父任务挪走了就不覆盖。
const DONE_SQL = `
  UPDATE tasks
     SET status = 'completed_no_pr',
         completed_at = COALESCE(completed_at, NOW()),
         result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $2::jsonb),
         updated_at = NOW()
   WHERE id = $1 AND status = 'blocked'`;

const DEAD_SQL = `
  UPDATE tasks
     SET status = 'failed', error_message = $2,
         result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $3::jsonb),
         updated_at = NOW()
   WHERE id = $1 AND status = 'blocked'`;

// 子任务行不见了，只标记一次。payload 里只加这一个键，回执七键原样带过去 —— 不可变触发器
// （BEFORE UPDATE OF task_type, payload）会对比那七个键，`||` 合并不动它们就放行。
const MARK_MISSING_SQL = `
  UPDATE tasks
     SET payload = COALESCE(payload, '{}'::jsonb)
                   || jsonb_build_object('qiumi_device_child_missing_at', $2::text),
         updated_at = NOW()
   WHERE id = $1 AND status = 'blocked'`;

/**
 * 子任务留下的可见结论。取法与 notion-gtd-sync.js 的 resultTextOf 一致——
 * 回执长得不一样，中文表「OpenClaw结果」列就是一片空白，主理人看不到这台手机到底干了什么。
 */
function visibleText(result) {
  const r = result?.receipt ?? result ?? {};
  const t = r.finalAssistantVisibleText ?? r.text ?? r.summary;
  return t ? String(t) : '设备任务已完成';
}

/**
 * 把已终态的 device_job 子任务回写到挂起的父 qiumi_task。
 *
 * @param {{query: Function}} pool
 * @returns {Promise<{checked: number, completed: number, failed: number}>}
 */
export async function reconcileDelegatedDeviceJobs(pool) {
  const { rows } = await pool.query(SCAN_SQL);
  let completed = 0;
  let failed = 0;

  for (const parent of rows) {
    try {
      const child = (await pool.query(CHILD_SQL, [parent.device_task_id])).rows[0];
      // 子任务行查不到（被删/id 写坏）→ 不动父任务状态：宁可挂着让人查，
      // 也不替一件不知死活的活销账，更不能反过来判它死。但要留一次痕，
      // 否则这条父任务会无声无息地挂到天荒地老。只留一次：60s 一轮，重复留痕会刷爆 task_events。
      if (!child) {
        if (!parent.child_missing_at) {
          const at = new Date().toISOString();
          await recordTaskEventSafe(pool, parent.id, 'qiumi_device_child_missing', {
            device_task_id: parent.device_task_id, at,
          });
          await pool.query(MARK_MISSING_SQL, [parent.id, at]);
        }
        continue;
      }

      if (DONE.has(child.status)) {
        const text = visibleText(child.result);
        // 回执与收割器（openclaw-agent-executor）同形：中文表的 resultTextOf 先读
        // receipt.finalAssistantVisibleText，读不到才退 text/summary。
        const receipt = {
          finalAssistantVisibleText: text,
          text,
          device_task_id: child.id,
          child_status: child.status,
          reaped_at: new Date().toISOString(),
        };
        await pool.query(DONE_SQL, [parent.id, JSON.stringify(receipt)]);
        completed += 1;
        await recordTaskEventSafe(pool, parent.id, 'qiumi_device_reconciled', {
          device_task_id: child.id, child_status: child.status, outcome: 'completed_no_pr',
        });
        continue;
      }

      if (DEAD.has(child.status)) {
        await pool.query(DEAD_SQL, [parent.id, `device_job_${child.status}`, JSON.stringify({
          device_task_id: child.id,
          child_status: child.status,
          error_message: child.error_message ?? null,
        })]);
        failed += 1;
        await recordTaskEventSafe(pool, parent.id, 'qiumi_device_reconciled', {
          device_task_id: child.id, child_status: child.status, outcome: 'failed',
          child_error: child.error_message ?? null,
        });
      }
      // 其余状态（queued/in_progress/blocked/…）= 子任务还在跑，原地不动。
    } catch (err) {
      // 一条对不上不该让整轮罢工——后面那些父任务同样在等放行。
      console.warn(`[qiumi-device-reconcile] 父任务 ${parent.id} 对账失败：${err.message}`);
    }
  }

  return { checked: rows.length, completed, failed };
}
