import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let policy = {}; try { policy = require('./attempt-resource-policy.cjs'); } catch (e) { if(e.code !== 'MODULE_NOT_FOUND') throw e; }
describe('Harness 预约与硬限共享受信预算', () => {
  it.each([['commander',1],['planner',1],['reviewer',1],['reporter',1],['publisher',1],['proposer',2],['generator',4],['evaluator',4],['judge',4]])('%s 同源权重 %s', (role, weight) => {
    expect(policy).toHaveProperty('resolveAttemptResourcePlan');
    const plan = policy.resolveAttemptResourcePlan({ workerId: 'us-mac-m4', role });
    expect(plan.weight).toBe(weight);
    expect(plan.runner).toEqual({ cpus: .5 * weight, memoryBytes: 1024 ** 3 * weight, pidsLimit: 128 * weight });
    expect(plan.postgres).toBeNull();
  });
  it.each(['planner','generator'])('%s 的 Postgres 从预约总额内分配', role => {
    const plan = policy.resolveAttemptResourcePlan({ workerId: 'us-mac-m4', role, postgres: true });
    expect(plan.postgres).toEqual({ cpus: .25, memoryBytes: 256 * 1024 ** 2, pidsLimit: 32 });
    for (const key of ['cpus','memoryBytes','pidsLimit']) expect(plan.runner[key] + plan.postgres[key]).toBe(plan.total[key]);
    if(role === 'planner') expect(plan.runner).toEqual({cpus:.25,memoryBytes:768*1024**2,pidsLimit:96});
  });
  it('默认未知节点或角色不可生成硬限，外来 limits 无效', () => {
    expect(() => policy.resolveAttemptResourcePlan({workerId:'future-linux',role:'generator'})).toThrow();
    expect(() => policy.resolveAttemptResourcePlan({workerId:'us-mac-m4',role:'unknown'})).toThrow();
    expect(policy.resolveAttemptResourcePlan({workerId:'us-mac-m4',role:'planner',limits:{memoryBytes:-1}}).runner.memoryBytes).toBe(1024**3);
  });
});
