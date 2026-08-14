/**
 * line-strategist-dispatch.js
 *
 * task 落终态（completed/failed）后，按其所属 line（journey_id，来自 payload）
 * 派发一个 task_type=strategist_decision 任务，触发 line-strategist skill。
 *
 * 轮询式而非侵入式：task 终态写入分散在 6+ 个文件的原始 SQL UPDATE 中，
 * 逐一插桩改动面大且易漏；改为周期扫描，与写入点解耦。
 *
 * 防抖去重两层：
 *  1. 扫描窗口只看近 N 分钟内落终态且未被本模块处理过的任务（payload.strategist_dispatched 标记）
 *  2. 建任务前查该 journey_id 是否已有排队中的 strategist_decision，存在则跳过
 */
import { createTask } from './actions.js';

export async function dispatchStrategistDecisions(pool, { windowMinutes = 10, taskCreator = createTask } = {}) {
  const scanResult = await pool.query(
    `SELECT id, payload->>'journey_id' AS journey_id, status
     FROM tasks
     WHERE status IN ('completed', 'failed')
       AND task_type <> 'strategist_decision'
       AND payload->>'journey_id' IS NOT NULL
       AND updated_at > NOW() - ($1 || ' minutes')::INTERVAL
       AND NOT (payload ? 'strategist_dispatched')`,
    [windowMinutes]
  );

  const terminalTasks = scanResult.rows;
  if (terminalTasks.length === 0) {
    return { scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0, failed: 0 };
  }

  // 按 journey_id 分组
  const byJourney = new Map();
  for (const t of terminalTasks) {
    if (!byJourney.has(t.journey_id)) byJourney.set(t.journey_id, []);
    byJourney.get(t.journey_id).push(t);
  }

  let dispatched = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (const [journeyId, group] of byJourney) {
    try {
      const dupCheck = await pool.query(
        `SELECT 1 FROM tasks
         WHERE status = 'queued' AND task_type = 'strategist_decision'
           AND payload->>'journey_id' = $1
         LIMIT 1`,
        [journeyId]
      );

      if (dupCheck.rows.length > 0) {
        skippedDuplicate++;
      } else {
        await taskCreator({
          db: pool,
          source: 'child',
          source_id: `line-strategist:${journeyId}:${group.map(t => t.id).sort().join(',')}`,
          title: `Line 军师决策 — journey ${journeyId}`,
          description: '任务终态触发（run_terminal），line-strategist 分析该 line 近期完成/失败任务并给出决策',
          task_type: 'strategist_decision',
          priority: 'P2',
          trigger_source: 'brain_auto',
          allow_unscoped: true,
          payload: {
              journey_id: journeyId,
              trigger: 'run_terminal',
              trigger_context: { terminal_task_ids: group.map(t => t.id) },
          },
        });
        dispatched++;
      }
    } catch (err) {
      failed++;
      console.error(`[line-strategist-dispatch] journey ${journeyId} 派发失败（非致命，本轮仍标记源任务，避免死循环重试）:`, err.message);
    }
  }

  // 标记本轮已处理的任务，无论 3a 是查重跳过还是新建都要标记
  let marked = 0;
  for (const t of terminalTasks) {
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || '{"strategist_dispatched": true}'::jsonb
       WHERE id = $1`,
      [t.id]
    );
    marked++;
  }

  return { scanned: terminalTasks.length, dispatched, skipped_duplicate: skippedDuplicate, marked, failed };
}
