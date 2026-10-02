import './scheduler-jobs.fixtures.js';
vi.mock('../app-server/controller.js',()=>({reconcileAppServers:vi.fn().mockResolvedValue([])}));
import { runPreviewCacheJanitor } from '../preview-cache-scheduler.js';
import { runNodeOnboardingJob } from '../node-onboarding/service.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  runSchedulerJobsOnce,
  startSchedulerJobsLoop,
  stopSchedulerJobsLoop,
  JOBS,
  SENTINEL_KEY_PREFIX,
} from '../scheduler-jobs.js';
import * as schedulerJobsModule from '../scheduler-jobs.js';
const { startProjectionJobsLoop, stopProjectionJobsLoop } = schedulerJobsModule;
import { triggerArchReview, triggerCiPatrol } from '../daily-review-scheduler.js';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';
import { scheduleDailyBackup } from '../daily-backup-scheduler.js';
import { maybeGenerateBattleReport } from '../battle-report.js';
import { maybeRunLineDreaming } from '../line-dreaming.js';
import { maybeRunLedgerHygiene } from '../ledger-hygiene.js';
import { runCaptureTriage } from '../capture-triage.js';
import { runReceiptCollector } from '../receipt-collector.js';
import { runLaunchdPatrol } from '../launchd-patrol.js';
import { maybeRunDirectionProposer } from '../direction-proposer.js';
import { runPostdeployVerifier } from '../postdeploy-verifier.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('scheduler-jobs 注册表', () => {
  it('节点接入对账使用数据库连接并保留 handler 结果', async () => {
    const pool = makePool();
    const job = JOBS.find(row => row.name === 'node-onboarding');
    expect(job?.needsPool).toBe(true);
    await runSchedulerJobsOnce(pool, [job]);
    expect(runNodeOnboardingJob).toHaveBeenCalledWith(pool);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('JOBS 注册了正确数量的 job（含 triage-officer-rank + triage-officer-15min + conversation-ttl-archiver）', () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toContain('triage-officer-rank');
    expect(names).toContain('triage-officer-15min');
    expect(names).toContain('conversation-ttl-archiver');
    expect(names).toContain('conversation-capture');
    // G1 刀2：模型账号配额采集必须挂在调度表里（PR #5411 只导出未注册，生产表恒空——2026-09-19 实证）
    expect(names).toContain('ops-model-accounts-collector');
    expect(names).toContain('backbone-contract-sync');
    expect(names.indexOf('ops-model-accounts-collector')).toBeGreaterThan(names.indexOf('ops-collector'));
    // conversation-ttl-archiver 排在 conversation-capture 之后
    expect(names.indexOf('conversation-ttl-archiver')).toBeGreaterThan(names.indexOf('conversation-capture'));
  });

  // PR3 补充五：秋米设备任务改成派生子任务后，父 qiumi_task 挂在 blocked 且 blocked_until 为 NULL——
  // 自动解闸器捞不到它，这个 job 是唯一的放行方。没注册 = 每条设备任务的父行永远挂着，
  // 中文表里永远停在「进行中」。
  it('JOBS 注册了 qiumi-device-reconcile（设备子任务终态回写父任务）', () => {
    const j = JOBS.find((x) => x.name === 'qiumi-device-reconcile');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(typeof j.handler).toBe('function');
  });

  // 任务 5cdbd52a：script_run 的收割者。没注册 = 脚本步派出去永远没人读 .exit，任务永远 in_progress。
  it('JOBS 注册了 script-reaper（needsPool、在 scheduler-liveness 之前、handler 真接线 reapScriptRuns）', async () => {
    const { reapScriptRuns } = await import('../script-executor.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'script-reaper');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(names.indexOf('script-reaper')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(reapScriptRuns).toHaveBeenCalledWith(pool);
  });

  // 任务 8aa79219：owner_decision「到期按默认走」的执行者。没注册 = 协议承诺无人兑现，不可逆决策永卡、可逆决策不走默认。
  it('JOBS 注册了 owner-decision-deadline（needsPool、声明活性尺子、在 scheduler-liveness 之前、handler 真接线）', async () => {
    const { runOwnerDecisionDeadline } = await import('../owner-decision-deadline.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'owner-decision-deadline');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.livenessIntervalSec).toBe(60);
    expect(j.timeoutMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(String(j.description)).toContain('owner_decision');
    expect(names.indexOf('owner-decision-deadline')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runOwnerDecisionDeadline).toHaveBeenCalledWith(pool);
  });

  // 任务 3d0db274：recurring_tasks 定时引擎自 2026-05 停摆，根因之一是 checkRecurringTasks 只挂在
  // 废弃的 tick-runner.executeTick，现役调度表里没有它。没注册 = 主理人排的定时单永远不出实例。
  it('JOBS 注册了 recurring-tasks（needsPool、在 scheduler-liveness 之前、handler 真接线 runRecurringTasksJob）', async () => {
    const { runRecurringTasksJob } = await import('../recurring.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'recurring-tasks');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(names.indexOf('recurring-tasks')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runRecurringTasksJob).toHaveBeenCalledWith(pool);
  });

  // 任务 309d864c：P1/P2 汇总自 2026-05 从未发出（生产 last_p1_flush/last_p2_flush 均为 null），根因之一
  // 是 flushAlertsIfNeeded 只挂在废弃的 tick-runner.executeTick，现役调度表里没有它。
  it('JOBS 注册了 alerting-flush（在 scheduler-liveness 之前、handler 真接线 flushAlertsIfNeeded）', async () => {
    const { flushAlertsIfNeeded } = await import('../alerting.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'alerting-flush');
    expect(j).toBeTruthy();
    expect(j.timeoutMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(names.indexOf('alerting-flush')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    const [r] = await runSchedulerJobsOnce(pool, [j]);
    expect(flushAlertsIfNeeded).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  it('JOBS 注册了 skill-inventory-sync（needsPool、200s 超时、在 skill-dist-drift 之后且在 scheduler-liveness 之前、handler 真接线）', async () => {
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'skill-inventory-sync');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBe(200_000);
    expect(names.indexOf('skill-inventory-sync')).toBeGreaterThan(names.indexOf('skill-dist-drift'));
    expect(names.indexOf('skill-inventory-sync')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const { runSkillInventorySync } = await import('../skill-inventory-sync.js');
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runSkillInventorySync).toHaveBeenCalled();
  });

  it('JOBS 注册了 skill-registry-projection（needsPool、在 skill-inventory-sync 之后且在 scheduler-liveness 之前、handler 真接线）', async () => {
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'skill-registry-projection');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(names.indexOf('skill-registry-projection')).toBeGreaterThan(names.indexOf('skill-inventory-sync'));
    expect(names.indexOf('skill-registry-projection')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const { runSkillRegistryProjection } = await import('../skill-registry-projection.js');
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runSkillRegistryProjection).toHaveBeenCalled();
  });

  it('JOBS 注册了 workflow-run-lost-deadline（needsPool、在 scheduler-liveness 之前、handler 真接线 runWorkflowRunLostDeadline）', async () => {
    const { runWorkflowRunLostDeadline } = await import('../workflow-run-lost-deadline.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'workflow-run-lost-deadline');
    expect(j).toBeDefined();
    expect(j.needsPool).toBe(true);
    expect(j.description).toMatch(/lost_deadline/);
    expect(names.indexOf('workflow-run-lost-deadline')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runWorkflowRunLostDeadline).toHaveBeenCalledWith(pool);
  });

  it('JOBS 注册了 commander-watchdog 与 workflow-trend-bark（needsPool、在 scheduler-liveness 之前、handler 真接线）', async () => {
    const { runCommanderWatchdog, runWorkflowTrendBark } = await import('../commander-watchdog.js');
    const names = JOBS.map((j) => j.name);
    for (const [name, fn] of [['commander-watchdog', runCommanderWatchdog], ['workflow-trend-bark', runWorkflowTrendBark]]) {
      const j = JOBS.find((x) => x.name === name);
      expect(j, name).toBeDefined();
      expect(j.needsPool).toBe(true);
      expect(names.indexOf(name)).toBeLessThan(names.indexOf('scheduler-liveness'));
      const pool = makePool();
      await runSchedulerJobsOnce(pool, [j]);
      expect(fn).toHaveBeenCalledWith(pool);
    }
    expect(JOBS.find((x) => x.name === 'commander-watchdog').description).toMatch(/心跳/);
    expect(JOBS.find((x) => x.name === 'workflow-trend-bark').description).toMatch(/Bark/);
  });

  it('注册 scheduler-liveness 且排在 JOBS 末尾，把 JOBS 自身注入 handler（不 import 成环）', async () => {
    const { runSchedulerLiveness } = await import('../ops-scheduler-liveness.js');
    const names = JOBS.map((j) => j.name);
    expect(names[names.length - 1]).toBe('scheduler-liveness');
    const pool = makePool();
    await runSchedulerJobsOnce(pool, JOBS.filter((j) => j.name === 'scheduler-liveness'));
    expect(runSchedulerLiveness).toHaveBeenCalledWith(pool, expect.objectContaining({ jobs: JOBS, self: 'scheduler-liveness' }));
  });

  it('runSchedulerJobsOnce 调用全部 job，needsPool 决定传参', async () => {
    const { runOpsCollector } = await import('../ops-collector.js');
    const { runOpenclawGuards } = await import('../openclaw-guards.js');
    const pool = makePool();
    const results = await runSchedulerJobsOnce(pool);
    expect(runOpsCollector).toHaveBeenCalledWith(pool);
    expect(runOpenclawGuards).toHaveBeenCalledWith(pool, expect.objectContaining({ raiseFn: expect.any(Function) }));
    expect(triggerArchReview).toHaveBeenCalledWith(pool);
    expect(triggerCiPatrol).toHaveBeenCalledWith(pool);
    expect(maybeTriggerStrategySession).toHaveBeenCalledWith(pool);
    expect(scheduleDailyBackup).toHaveBeenCalledWith(pool);
    expect(maybeRunLineDreaming).toHaveBeenCalledWith(pool);
    expect(maybeRunLedgerHygiene).toHaveBeenCalledWith(pool);
    expect(maybeGenerateBattleReport).toHaveBeenCalledWith(pool);
    expect(runCaptureTriage).toHaveBeenCalledWith(pool);
    expect(runReceiptCollector).toHaveBeenCalledWith(pool);
    expect(runLaunchdPatrol).toHaveBeenCalledWith();
    expect(maybeRunDirectionProposer).toHaveBeenCalledWith(pool);
    expect(runPostdeployVerifier).toHaveBeenCalledWith(pool);
    expect(results).toHaveLength(JOBS.length);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('单 job reject 不影响其余 job，且结果记录 ok:false', async () => {
    const pool = makePool();
    triggerArchReview.mockRejectedValueOnce(new Error('boom'));
    const results = await runSchedulerJobsOnce(pool);
    expect(results.find((r) => r.name === 'arch-review')).toMatchObject({ ok: false, error: 'boom' });
    expect(results.filter((r) => r.name !== 'arch-review').every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(JOBS.length);
  });

  it('handler 永挂时按 timeoutMs 标记 timedOut 并继续', async () => {
    const pool = makePool();
    const hangJobs = [
      { name: 'hang', needsPool: false, timeoutMs: 10, handler: () => new Promise(() => {}) },
      { name: 'after', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue('ok') },
    ];
    const results = await runSchedulerJobsOnce(pool, hangJobs);
    expect(results[0]).toMatchObject({ name: 'hang', ok: false, timedOut: true });
    expect(results[1].ok).toBe(true);
  });

  it('哨兵用 ON CONFLICT upsert 写 working_memory，key 带前缀', async () => {
    const pool = makePool();
    await runSchedulerJobsOnce(pool);
    const sentinelCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('working_memory') && sql.includes('ON CONFLICT'));
    expect(sentinelCalls).toHaveLength(JOBS.length);
    const archReviewCall = sentinelCalls.find(([, params]) => params[0] === `${SENTINEL_KEY_PREFIX}arch-review`);
    expect(archReviewCall[0]).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    const payload = JSON.parse(archReviewCall[1][1]);
    expect(payload).toHaveProperty('at');
    expect(payload).toHaveProperty('ok');
  });

  it('哨兵写入失败不影响 job 结果也不抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const results = await runSchedulerJobsOnce(pool);
    expect(results).toHaveLength(JOBS.length);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('handler 返回 liveness_at → 哨兵 record 原样带上（活性只认 handler 自报的完成时刻）', async () => {
    const pool = makePool();
    const jobs = [
      { name: 'self-report', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ loop: 'running', liveness_at: '2026-09-24T02:00:00.000Z' }) },
      { name: 'plain', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ ok: true }) },
    ];
    await runSchedulerJobsOnce(pool, jobs);
    const rec = (name) => JSON.parse(pool.query.mock.calls.find(([sql, p]) => sql.includes('working_memory') && p[0] === `${SENTINEL_KEY_PREFIX}${name}`)[1][1]);
    expect(rec('self-report')).toMatchObject({ ok: true, liveness_at: '2026-09-24T02:00:00.000Z' });
    expect(rec('plain')).not.toHaveProperty('liveness_at');
  });

  it('notion-gtd-sync 声明 livenessIntervalSec=30（内层 30s 循环的尺子）', () => {
    const job = JOBS.find((j) => j.name === 'notion-gtd-sync');
    expect(job.livenessIntervalSec).toBe(30);
  });

  it('liveness_at 非 string（null / Date / number）不透传进哨兵 record', async () => {
    const pool = makePool();
    const jobs = [
      { name: 'null-at', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ liveness_at: null }) },
      { name: 'date-at', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ liveness_at: new Date() }) },
      { name: 'num-at', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ liveness_at: 1758675600000 }) },
    ];
    await runSchedulerJobsOnce(pool, jobs);
    const rec = (name) => JSON.parse(pool.query.mock.calls.find(([sql, p]) => sql.includes('working_memory') && p[0] === `${SENTINEL_KEY_PREFIX}${name}`)[1][1]);
    for (const name of ['null-at', 'date-at', 'num-at']) expect(rec(name)).not.toHaveProperty('liveness_at');
  });
});

describe('scheduler-jobs loop 幂等与重入守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopSchedulerJobsLoop();
    vi.useRealTimers();
  });

  it('start 时写入 scheduler_jobs_expected 预期数（供死人开关比对）', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    await Promise.resolve();
    await Promise.resolve();
    const call = pool.query.mock.calls.find(
      ([sql, params]) => sql.includes('working_memory') && Array.isArray(params) && params[0] === 'scheduler_jobs_expected',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1][1])).toEqual({ count: JOBS.length });
  });

  it('重复调用 startSchedulerJobsLoop 返回同一 timer', () => {
    const pool = makePool();
    const t1 = startSchedulerJobsLoop(pool);
    const t2 = startSchedulerJobsLoop(pool);
    expect(t2).toBe(t1);
  });

  it('前进 60s 触发一轮，各 handler 各被调用一次', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
    expect(maybeTriggerStrategySession).toHaveBeenCalledTimes(1);
  });

  it('重入守卫：慢 handler 挂起时前进 120s 不叠加并发', async () => {
    const pool = makePool();
    triggerArchReview.mockImplementationOnce(() => new Promise(() => {}));
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(120 * 1000);
    // 首轮在 arch-review 处挂起，running 仍为 true，第二次 tick 应被守卫短路，
    // arch-review 只被调用一次（无守卫则会被第二轮再调一次）。
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
  });

  it('stopSchedulerJobsLoop 后前进 60s 不再触发', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    stopSchedulerJobsLoop();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(triggerArchReview).not.toHaveBeenCalled();
  });
});

describe('projection 独立调度 loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    schedulerJobsModule.stopProjectionJobsLoop?.();
    stopSchedulerJobsLoop();
    vi.useRealTimers();
  });

  it('projection jobs 不进入慢速串行队列，但仍保留在总注册表和哨兵计数中', () => {
    expect(schedulerJobsModule.SERIAL_JOBS).toBeInstanceOf(Array);
    const independentNames = schedulerJobsModule.PROJECTION_JOBS.map(job => job.name);
    expect(independentNames).toEqual([
      'notion-task-command-ingest',
      'projection-command-apply',
      'projection-outbox',
      'notion-company-key-results',
      'notion-kr-projection',
    ]);
    expect(schedulerJobsModule.SERIAL_JOBS.map(job => job.name)).not.toEqual(
      expect.arrayContaining(independentNames),
    );
    expect(JOBS.map(job => job.name)).toEqual(expect.arrayContaining(independentNames));
  });

  it('慢速串行 job 挂起时，projection 仍在独立 loop 立即执行并按 60s 继续', async () => {
    expect(schedulerJobsModule.startProjectionJobsLoop).toBeTypeOf('function');
    const pool = makePool();
    triggerArchReview.mockImplementationOnce(() => new Promise(() => {}));
    const projectionRunner = vi.fn().mockResolvedValue([]);

    startSchedulerJobsLoop(pool);
    schedulerJobsModule.startProjectionJobsLoop(pool, { runOnce: projectionRunner });
    await Promise.resolve();
    await Promise.resolve();
    expect(projectionRunner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
    expect(projectionRunner).toHaveBeenCalledTimes(2);
    expect(projectionRunner.mock.calls[0][1].map(job => job.name)).toEqual([
      'notion-task-command-ingest',
      'projection-command-apply',
      'projection-outbox',
      'notion-company-key-results',
      'notion-kr-projection',
    ]);
  });

  it('上一轮 projection 未结束时不叠加下一轮', async () => {
    expect(schedulerJobsModule.startProjectionJobsLoop).toBeTypeOf('function');
    const projectionRunner = vi.fn(() => new Promise(() => {}));
    schedulerJobsModule.startProjectionJobsLoop(makePool(), { runOnce: projectionRunner });
    await vi.advanceTimersByTimeAsync(120 * 1000);
    expect(projectionRunner).toHaveBeenCalledTimes(1);
  });
});

describe('capture-triage job 注册', () => {
  it('capture-triage 已注册（needsPool=true）', () => {
    const job = JOBS.find((j) => j.name === 'capture-triage');
    expect(job).toBeTruthy();
    expect(job.needsPool).toBe(true);
    expect(typeof job.handler).toBe('function');
  });
});

describe('line-dreaming job 注册', () => {
  it('JOBS 里存在 line-dreaming，且排在 battle-report 之前', () => {
    const dreamIdx = JOBS.findIndex((j) => j.name === 'line-dreaming');
    const reportIdx = JOBS.findIndex((j) => j.name === 'battle-report');
    expect(dreamIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(dreamIdx).toBeLessThan(reportIdx);
  });
});

describe('conversation-ttl-archiver job 注册', () => {
  it('conversation-ttl-archiver 已注册（needsPool=true）', () => {
    const job = JOBS.find((j) => j.name === 'conversation-ttl-archiver');
    expect(job).toBeTruthy();
    expect(job.needsPool).toBe(true);
    expect(typeof job.handler).toBe('function');
  });
});

// [BEHAVIOR] B-1~B-4: Preview Brain 隔离守卫
// 防并发重复派发：BRAIN_PREVIEW=1 时 scheduler-jobs loop 不启动
describe('scheduler-jobs Preview Brain 隔离（BRAIN_PREVIEW=1 幂等保护）', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.BRAIN_PREVIEW;
  });

  afterEach(() => {
    stopSchedulerJobsLoop();
    stopProjectionJobsLoop?.();
    vi.useRealTimers();
    consoleSpy.mockRestore();
    delete process.env.BRAIN_PREVIEW;
  });

  // [BEHAVIOR] B-1
  it('BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 返回 null，不启动 setInterval', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    const timer = startSchedulerJobsLoop(pool);
    expect(timer).toBeNull();
  });

  // [BEHAVIOR] B-2
  it('BRAIN_PREVIEW=1 时 startProjectionJobsLoop 返回 null，不启动 setInterval', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    const timer = startProjectionJobsLoop(pool);
    expect(timer).toBeNull();
  });

  // [BEHAVIOR] B-3: 非 Preview 时正常启动（零回归）
  it('BRAIN_PREVIEW 未设置时 startSchedulerJobsLoop 正常启动，前进 60s 触发 handler', async () => {
    const pool = makePool();
    const timer = startSchedulerJobsLoop(pool);
    expect(timer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    const { triggerArchReview } = await import('../daily-review-scheduler.js');
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
  });

  // [BEHAVIOR] B-4: Preview 模式打印含 "BRAIN_PREVIEW" 字样的日志
  it('BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 打印含 BRAIN_PREVIEW 的日志', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    const logged = consoleSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/BRAIN_PREVIEW/);
  });
});

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
