// 收尾与派发开关无关。超时只记录观察失败，真实调用结束前不能重复执行。
const INTERVAL_MS = 10_000;
const pending = new Set();
let timer = null;

export function startCompletionJobsLoop(pool, jobs, runOnce) {
  if (timer) return timer;
  timer = setInterval(() => {
    for (const job of jobs) {
      if (pending.has(job.name)) continue;
      pending.add(job.name);
      const invocation = Promise.resolve()
        .then(() => job.needsPool ? job.handler(pool) : job.handler())
        .finally(() => pending.delete(job.name));
      // 沿用统一job的超时、错误及哨兵记录；不把观察超时当作副作用已结束。
      runOnce(pool, [{ ...job, handler: () => invocation }])
        .catch(() => {}); // runOnce 已负责错误哨兵；不输出业务内容。
    }
  }, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function stopCompletionJobsLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  // 不清pending：stop/start不能把仍在执行的远端请求变成可重入。
}
