const pools = new WeakMap();

// 同一pool的同类收割保持单写；legacy与managed使用不同锁。
export function runScriptReaperLane(pool, lane, run) {
  if (!pools.has(pool)) pools.set(pool, new Map());
  const lanes = pools.get(pool);
  if (!lanes.has(lane)) lanes.set(lane, { cursor: null, pending: null });
  const state = lanes.get(lane);
  if (state.pending) return state.pending;
  state.pending = Promise.resolve().then(() => run(state)).finally(() => { state.pending = null; });
  return state.pending;
}
