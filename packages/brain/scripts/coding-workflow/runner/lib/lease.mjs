// 统一领单租约心跳（派发总闸 G，任务 c5f6e683）：执行期间每 intervalMs 调 POST /tasks/:id/heartbeat 续约。
// 409 = Brain 已按租约语义回收（判 lost / 回队）→ 停心跳并 onLost()（调用方中止执行器、不再回写）；
// 404 = 旧 Brain 没有该端点、网络错误 = 暂时失败：都不判丢，下一拍再续。
export function startLeaseHeartbeat({ brain, taskId, claimer, leaseSeconds, intervalMs, onLost, log = () => {} }) {
  let lost = false;
  let timer = null;
  let busy = false;
  const beat = async () => {
    if (busy || lost) return;
    busy = true;
    try {
      const r = await brain.heartbeat(taskId, claimer, leaseSeconds);
      if (r?.status === 409) {
        lost = true;
        clearInterval(timer);
        log(`任务 ${taskId} 心跳 409 lease_lost：租约已被 Brain 回收`);
        onLost?.();
      }
    } catch (error) {
      log(`任务 ${taskId} 心跳失败（不判丢）：${error?.message || error}`);
    } finally {
      busy = false;
    }
  };
  if (leaseSeconds && intervalMs && typeof brain?.heartbeat === 'function') {
    timer = setInterval(beat, intervalMs);
    timer.unref?.();
  }
  return {
    stop: () => { if (timer) clearInterval(timer); timer = null; },
    lost: () => lost,
  };
}
