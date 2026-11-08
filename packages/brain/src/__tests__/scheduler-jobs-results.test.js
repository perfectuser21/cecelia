import { describe, it, expect, vi } from "vitest";
import { makePool } from "./helpers/scheduler-jobs-fixture.js";
import { runNativeReconcile } from '../lib/workflow-assembly-native.js';
import { runImageRetentionJanitor } from '../image-retention-scheduler.js';
import { runPreviewCacheJanitor } from '../preview-cache-scheduler.js';
import { runSchedulerJobsOnce, JOBS } from '../scheduler-jobs.js';
it('专属cache scheduler需要pool并进入默认停用Janitor合同', async () => {
  const job = JOBS.find(row => row.name === 'preview-owned-cache-janitor');
  expect(job).toMatchObject({ needsPool: true });
  const pool = {}; await job.handler(pool);
  expect(runPreviewCacheJanitor).toHaveBeenCalledWith(pool);
});
it('机器体征始终先采集，Janitor网络等待不能排在体征前', () => {
  expect(JOBS[0].name).toBe('machine-vitals');
  expect(JOBS.findIndex(job => job.name === 'preview-owned-cache-janitor')).toBeGreaterThan(0);
});

it('US固定镜像策略进入默认停用Janitor合同且在体征采样之后',async()=>{
 const job=JOBS.find(row=>row.name==='us-brain-image-janitor');expect(job).toMatchObject({needsPool:true});
 const pool={};await job.handler(pool);expect(runImageRetentionJanitor).toHaveBeenCalledWith(pool);
 expect(JOBS.findIndex(row=>row===job)).toBeGreaterThan(0);
});

// 决策 ff2019e2：定时任务每次真实执行写一行 runs（带真实起止），模块自 gate 跳过的那一轮不记。
describe('scheduler-jobs 写运行记录', () => {
  const runInserts = pool => pool.query.mock.calls.filter(([sql]) => /INSERT INTO runs/.test(sql));
  it('真跑的一轮写 runs：outcome=pass，起止是真实计时', async () => {
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [{ name: 'real-job', handler: async () => { await new Promise(r => setTimeout(r, 20)); return { processed: 3 }; } }]);
    const calls = runInserts(pool);
    expect(calls).toHaveLength(1);
    const params = calls[0][1];
    expect(params).toContain('real-job');
    expect(params).toContain('pass');
    const times = params.filter(p => p instanceof Date).map(p => p.getTime());
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(15);
  });
  it('自跳过的一轮（skipped / triggered:false / status:skipped / inWindow:false）不写 runs', async () => {
    const pool = makePool();
    const jobs = [{ skipped: true }, { skipped: 'cooldown' }, { triggered: false }, { status: 'skipped' }, { inWindow: false }]
      .map((result, i) => ({ name: `skip-${i}`, handler: async () => result }));
    await runSchedulerJobsOnce(pool, jobs);
    expect(runInserts(pool)).toHaveLength(0);
  });
  it('抛错记 fail（带错误信息），返回 ok:false 也记 fail', async () => {
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [
      { name: 'boom-job', handler: async () => { throw new Error('炸了'); } },
      { name: 'notok-job', handler: async () => ({ ok: false }) },
    ]);
    const calls = runInserts(pool);
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toContain('fail');
    expect(calls[0][1]).toContain('炸了');
    expect(calls[1][1]).toContain('fail');
  });
  it('写 runs 失败不影响 job 结果与哨兵', async () => {
    const pool = { query: vi.fn(async (sql) => { if (/INSERT INTO runs/.test(sql)) throw new Error('relation "runs" does not exist'); return { rows: [] }; }) };
    const [r] = await runSchedulerJobsOnce(pool, [{ name: 'real-job', handler: async () => ({ processed: 1 }) }]);
    expect(r).toMatchObject({ name: 'real-job', ok: true });
    expect(pool.query.mock.calls.some(([sql]) => /working_memory/.test(sql))).toBe(true);
  });
});

it('装配持续对账只注册一个有界原scheduler入口且handler真实接线',async()=>{
 const matching=JOBS.filter(j=>j.name==='workflow-assembly-reconcile');expect(matching).toHaveLength(1);
 const job=matching[0];expect(job.timeoutMs).toBeGreaterThan(20000);expect(job.needsPool).toBe(true);
 const pool={query:vi.fn().mockResolvedValue({rows:[]})};await runSchedulerJobsOnce(pool,[job]);
 expect(runNativeReconcile).toHaveBeenCalledWith(pool);
});
