/**
 * manual-dispatch-device-gate.js — 手动派发端点的设备锁闸（Issue e03fc740）
 *
 * G5 设备锁已接线 dispatcher/worker-pool，但 POST /dispatch-now 与
 * POST /api/brain/tasks/:id/dispatch 两个手动入口绕过锁。铁律同 S2 锚点闸：
 * 闸必须站住所有必经之路。两端点共用本闸，语义与 dispatcher 接线一致：
 * - locked         → 409（不触发执行、不改任务状态）
 * - unknown_device → 422（提示 register 端点）
 * - acquired       → 放行，锁由任务终态链（task-updater/sweeper）释放
 * - acquire 抛异常 → fail-closed 按 locked 处理，绝不放行双 RPA 同机
 */
import { acquireDeviceLock, releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';

/**
 * 触发执行前的设备锁检查。
 * @returns {{pass:true, acquired:boolean}|{pass:false, status:number, body:object}}
 */
export async function checkDeviceLockForManualDispatch(task, tag) {
  const serial = task?.payload?.device_serial;
  if (!serial) return { pass: true, acquired: false };

  let lockRes;
  try {
    lockRes = await acquireDeviceLock(task.id, serial, task.payload?.device_ttl_minutes);
  } catch (err) {
    console.error(`[${tag}] acquireDeviceLock 异常（fail-closed 按 locked 处理）: ${err.message}`);
    lockRes = { result: 'locked', holder: null };
  }

  if (lockRes.result === 'locked') {
    return {
      pass: false,
      status: 409,
      body: {
        success: false,
        error: 'device_locked',
        locked_by: lockRes.holder?.locked_by ?? null,
        expires_at: lockRes.holder?.expires_at ?? null,
      },
    };
  }
  if (lockRes.result === 'unknown_device') {
    return {
      pass: false,
      status: 422,
      body: {
        success: false,
        error: 'unknown_device',
        device_serial: serial,
        hint: '设备未注册：先 POST /api/brain/device-locks/register',
      },
    };
  }
  return { pass: true, acquired: true };
}

/** 派发失败回滚点的锁释放（non-fatal：失败留痕，sweeper 对账兜底）。 */
export async function releaseDeviceLockNonFatal(taskId, tag) {
  try {
    await releaseDeviceLocksHeldBy(taskId);
  } catch (err) {
    console.error(`[${tag}] releaseDeviceLocksHeldBy 失败（non-fatal，sweeper 对账兜底）: ${err.message}`);
  }
}
