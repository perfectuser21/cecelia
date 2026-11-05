import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePool, schedulerBoundary } from './helpers/scheduler-jobs-fixture.js';
import { runNodeOnboardingJob } from '../node-onboarding/service.js';
import { runSchedulerJobsOnce, JOBS, SENTINEL_KEY_PREFIX } from '../scheduler-jobs.js';
import * as schedulerJobsModule from '../scheduler-jobs.js';
import { runPhoneRpaDispatch } from '../lib/phone-rpa-dispatch.js';
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
import { runDirectoryJob } from '../projection/directory-job.js';
it('手机独立派发注册30s节奏且不被串行慢job阻塞', () => {
  const job = JOBS.find(row => row.name === 'phone-rpa-dispatch');
  expect(job).toMatchObject({ needsPool: true, cadence: { everySec: 30 }, handler: runPhoneRpaDispatch });
  expect(schedulerJobsModule.COMPLETION_JOBS).toContain(job);
  expect(schedulerJobsModule.SERIAL_JOBS).not.toContain(job);
});
describe('scheduler-jobs 注册表', () => {
  it('退役 Claude worker 池不再注册周期派发任务', () => {
    expect(JOBS.map(job => job.name)).not.toContain('worker-pool-dispatch');
  });

  it('目录投影job隔离外部边界并准确传递同一pool', async () => {
    const pool = makePool();
    const job = JOBS.find(row => row.name === 'notion-directory');
    expect(job?.needsPool).toBe(true);
    const results = await runSchedulerJobsOnce(pool, [job]);
    expect(runDirectoryJob).toHaveBeenCalledTimes(1);
    expect(runDirectoryJob).toHaveBeenCalledWith(pool);
    expect(runDirectoryJob.mock.calls[0][0]).toBe(pool);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'notion-directory', ok: true });
  });
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

  // 闹钟总账（任务 fe10d1a0，决策 9e9d90b6）：新增定时只能经本表注册，且必须结构化声明"多久响一次"。
  // 漏声明 = 总账「多久响一次」列留空、活性尺子对不上；重名 = 总账唯一键 (source,host,label) 互相覆盖。
  it('每个 JOB 声明结构化 cadence（everySec 或 cron+tz），name 唯一', () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const j of JOBS) {
      const c = j.cadence;
      expect(c, `${j.name} 缺 cadence`).toBeTruthy();
      if (c.everySec !== undefined) {
        expect(Number.isFinite(c.everySec) && c.everySec > 0, `${j.name}.cadence.everySec`).toBe(true);
        expect(c.cron, `${j.name} 不能同时声明 everySec 与 cron`).toBeUndefined();
      } else {
        expect(typeof c.cron, `${j.name}.cadence 须是 everySec 或 cron`).toBe('string');
        expect(c.cron.trim().split(/\s+/), `${j.name} cron 须五段`).toHaveLength(5);
        expect(typeof c.tz, `${j.name} cron 必须带 tz`).toBe('string');
      }
    }
  });

  // 决策 c7ff6e02/9ec7a010：OpenClaw cron 运行记录入 runs 表，每 5 分钟；没注册 = runs 表永远没有 openclaw 行
  it('JOBS 注册了 openclaw-run-ingest（5 分钟、needsPool、挨着 ops-collector、handler 真接线）', async () => {
    const { runOpenclawRunIngest } = await import('../openclaw-run-ingest.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'openclaw-run-ingest');
    expect(j).toBeTruthy();
    expect(j.cadence.everySec).toBe(300);
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBe(120_000);
    expect(names.indexOf('openclaw-run-ingest')).toBe(names.indexOf('ops-collector') + 1);
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runOpenclawRunIngest).toHaveBeenCalledWith(pool);
  });

  // 任务 1b3c0000：技能工厂看板，调度器每 60s 调、handler 自 gate 5 分钟
  it('JOBS 注册了 skill-factory-board（挨着 runs-notion-push、needsPool、handler 真接线）', async () => {
    const { runSkillFactoryBoardPush } = await import('../skill-factory-board.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'skill-factory-board');
    expect(j).toBeTruthy();
    expect(j.cadence.everySec).toBe(60);
    expect(j.needsPool).toBe(true);
    expect(names.indexOf('skill-factory-board')).toBe(names.indexOf('runs-notion-push') + 1);
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runSkillFactoryBoardPush).toHaveBeenCalledWith(pool);
  });

  // 决策 9ec7a010：runs 投影到 Notion「最近执行」库，每 2 分钟；库未注册时 handler 安静跳过
  it('JOBS 注册了 runs-notion-push（120 秒、needsPool、挨着 openclaw-run-ingest、handler 真接线）', async () => {
    const { runRunsNotionPush } = await import('../runs-notion-projection.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'runs-notion-push');
    expect(j).toBeTruthy();
    expect(j.cadence.everySec).toBe(120);
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBe(110_000);
    expect(names.indexOf('runs-notion-push')).toBe(names.indexOf('openclaw-run-ingest') + 1);
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runRunsNotionPush).toHaveBeenCalledWith(pool);
  });

  // 派发总闸 H（任务 865b502c）：旁路动作扫描 + 按天汇总，调度器每 60s 调、handler 自 gate 5 分钟
  it('JOBS 注册了 bypass-audit（挨着 skill-factory-board、needsPool、handler 真接线）', async () => {
    const { runBypassAudit } = await import('../bypass-audit.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'bypass-audit');
    expect(j).toBeTruthy();
    expect(j.cadence.everySec).toBe(300);
    expect(j.needsPool).toBe(true);
    expect(names.indexOf('bypass-audit')).toBe(names.indexOf('skill-factory-board') + 1);
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(runBypassAudit).toHaveBeenCalledWith(pool);
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
  it('JOBS 注册了 script-reaper（needsPool、在 scheduler-liveness 之前、handler 真接线 legacy收割）', async () => {
    const { reapLegacyScriptRuns } = await import('../script-executor.js');
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'script-reaper');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(names.indexOf('script-reaper')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, [j]);
    expect(reapLegacyScriptRuns).toHaveBeenCalledWith(pool);
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


it('默认调度完整一轮只消费注入pool，不触canonical DB/网络/子进程', async () => {
  vi.clearAllMocks();
  await runSchedulerJobsOnce(makePool());
  await new Promise(resolve => setImmediate(resolve));
  expect(schedulerBoundary.db).not.toHaveBeenCalled();
  expect(schedulerBoundary.network).not.toHaveBeenCalled();
  expect(schedulerBoundary.process).not.toHaveBeenCalled();
});
