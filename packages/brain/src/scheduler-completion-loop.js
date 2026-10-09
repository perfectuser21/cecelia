// 收尾与派发开关无关。超时只记录观察失败，真实调用结束前不能重复执行。
const INTERVAL_MS = 10_000;
const pending = new Set();
const lastStarts = new WeakMap();
let timer = null;

export function startCompletionJobsLoop(pool, jobs, runOnce) {
  if (timer) return timer;
  timer = setInterval(() => {
    for (const job of jobs) {
      if (pending.has(job.name)) continue;
      const now = Date.now();
      const last = lastStarts.get(job.handler) ?? -Infinity;
      if (job.completionCadenceMs && now - last < job.completionCadenceMs) continue;
      lastStarts.set(job.handler, now);
      pending.add(job.name);
      const invocation = Promise.resolve()
        .then(() => job.needsPool ? job.handler(pool) : job.handler());
      // 沿用统一job的超时、错误及哨兵记录；不把观察超时当作副作用已结束。
      const observation = Promise.resolve().then(() => runOnce(pool, [{ ...job, handler: () => invocation }]));
      // 旧哨兵写也必须结束，避免下一次观测先落库、随后被旧at覆盖。
      Promise.allSettled([invocation, observation]).then(() => pending.delete(job.name));
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

