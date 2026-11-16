import { describe, it, expect } from 'vitest';
import { runFactoryCycle } from '../factory-cycle.js';
const emptyStore = { listCandidates: async () => [] };
describe('已有Task核验周期', () => {
  it('周期节流仍有效，force只重跑已有任务核验', async () => {
    const db = {}, t = Date.now() + 3600000;
    const deps = { judgeStore: emptyStore, now: () => new Date(t) };
    expect(await runFactoryCycle(db, deps)).toEqual({ judge: [] });
    expect(await runFactoryCycle(db, { ...deps, now: () => new Date(t + 60000) })).toEqual({ skipped: 'throttled' });
    expect(await runFactoryCycle(db, { ...deps, force: true })).toEqual({ judge: [] });
  });
  it('上一轮核验未完成时不重入，结束后可继续', async () => {
    let finish;
    const waiting = new Promise(resolve => { finish = resolve; });
    const running = runFactoryCycle({}, { force: true, judgeStore: { listCandidates: () => waiting } });
    expect(await runFactoryCycle({}, { force: true, judgeStore: emptyStore })).toEqual({ skipped: 'running' });
    finish([]);
    expect(await running).toEqual({ judge: [] });
    expect(await runFactoryCycle({}, { force: true, judgeStore: emptyStore })).toEqual({ judge: [] });
  });
});
