import { randomUUID } from 'node:crypto';
import { checkDeviceLockForManualDispatch, releaseDeviceLockNonFatal } from './manual-dispatch-device-gate.js';

/** 定向请求只释放自己的 claim；tick 未传 owner 时保持原协议。 */
export function releaseQiumiClaim(pool, taskId, owner) {
  return pool.query(
    `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1${owner ? ' AND claimed_by = $2' : ''}`,
    owner ? [taskId, owner] : [taskId],
  );
}

/** 两个定向入口共用：claim 时保持 queued，让现有路由落 run_id、部门及设备闸。 */
export async function dispatchManualQiumi(task, pool, deps = {}) {
  const owner = `manual-qiumi:${randomUUID()}`;
  const route = deps.route ?? (await import('../dispatcher.js')).dispatchQiumiTask;
  const trigger = deps.trigger ?? (await import('../executor.js')).triggerCeceliaRun;
  let deviceAcquired = false;
  let starting = false;
  let runId = null;
  const releaseClaim = () => releaseQiumiClaim(pool, task.id, owner);
  const response = (status, body) => ({ status, body: { task_id: task.id, ...body } });
  const uncertain = async () => {
    const note = { run_id: runId, message: `派发未确认，正在查询原运行 ${runId}；请勿重复创建任务`, at: new Date().toISOString() };
    await pool.query(
      `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('dispatch_uncertain', $3::jsonb), updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND status = 'in_progress'`,
      [task.id, owner, JSON.stringify(note)],
    ).catch(() => {}); // 写库仍不可用时保持原运行，不再启动第二次。
    return response(202, { run_id: runId, executor: 'openclaw-agent', execution_state: 'unknown', detail: note.message });
  };
  const claimed = await pool.query(
    `UPDATE tasks SET claimed_by = $2, claimed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'queued' AND claimed_by IS NULL RETURNING *`,
    [task.id, owner],
  );
  if (!claimed.rows.length) return response(409, { error: 'task_not_dispatchable', detail: '任务已被认领或已离开队列' });

  try {
    const routed = await route(claimed.rows[0], { claimOwner: owner });
    if (routed.outcome !== 'proceed') {
      await releaseClaim();
      const current = (await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id])).rows[0];
      const delegated = routed.result?.reason === 'qiumi_routed_device';
      return response(delegated ? 202 : current?.status === 'queued' ? 409 : 422, {
        error: delegated ? undefined : routed.result?.reason ?? current?.blocked_reason ?? 'qiumi_dispatch_deferred',
        execution_state: delegated ? 'delegated' : current?.status ?? 'deferred',
        detail: current?.blocked_detail ?? current?.error_message ?? routed.result ?? null,
      });
    }
    // 路由已经写好 payload；重读，不把入口 SELECT 的旧对象交给执行器。
    const current = (await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id])).rows[0];
    if (current?.status !== 'queued' || current.claimed_by !== owner) {
      await releaseClaim();
      return response(409, { error: 'task_changed_during_routing' });
    }
    if (!current.payload?.run_id || !current.payload?.qiumi_department) {
      await releaseClaim();
      return response(422, { error: 'qiumi_route_incomplete' });
    }
    runId = current.payload.run_id;
    const deviceGate = await checkDeviceLockForManualDispatch(current, 'manual-qiumi-dispatch');
    if (!deviceGate.pass) {
      await releaseClaim();
      return response(deviceGate.status, deviceGate.body);
    }
    deviceAcquired = deviceGate.acquired;
    const started = await pool.query(
      `UPDATE tasks SET status = 'in_progress', executor_kind = 'openclaw-agent',
        started_at = COALESCE(started_at, NOW()), updated_at = NOW(),
        metadata = COALESCE(metadata, '{}'::jsonb) || '{"manually_dispatched":true}'::jsonb
        WHERE id = $1 AND status = 'queued' AND claimed_by = $2 RETURNING *`,
      [task.id, owner],
    );
    if (!started.rows.length) {
      if (deviceAcquired) await releaseDeviceLockNonFatal(task.id, 'manual-qiumi-dispatch');
      await releaseClaim();
      return response(409, { error: 'task_changed_before_execution' });
    }
    starting = true;
    const result = await trigger(started.rows[0]);
    if (!result.success) {
      if (result.dispatchUncertain) return uncertain();
      if (!result.taskTerminal) {
        // 保留原 run_id。SSH 回应不确定时，下次仍由远端 ALREADY 探针防重。
        await pool.query(
          `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
            WHERE id = $1 AND status = 'in_progress' AND claimed_by = $2`,
          [task.id, owner],
        );
        if (deviceAcquired) await releaseDeviceLockNonFatal(task.id, 'manual-qiumi-dispatch');
      }
      return response(503, { error: result.reason ?? 'phone_executor_unavailable', detail: result.error });
    }
    return response(202, {
      title: task.title, run_id: result.runId ?? current.payload.run_id,
      executor: 'openclaw-agent', execution_state: 'accepted', dispatched_at: new Date().toISOString(),
    });
  } catch (error) {
    if (starting) {
      // 执行器可能已收 DISPATCHED/ALREADY，只是后续写库失败。保持运行事实供独立收割器查询。
      return uncertain();
    }
    if (deviceAcquired) await releaseDeviceLockNonFatal(task.id, 'manual-qiumi-dispatch');
    await releaseClaim();
    throw error;
  }
}
