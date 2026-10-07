vi.mock('../image-retention-scheduler.js', () => ({ runImageRetentionJanitor: vi.fn().mockResolvedValue({ status: 'disabled' }) }));
import { runImageRetentionJanitor } from '../image-retention-scheduler.js';
vi.mock('../app-server/controller.js',()=>({reconcileAppServers:vi.fn().mockResolvedValue([])}));
vi.mock('../preview-cache-scheduler.js', () => ({ runPreviewCacheJanitor: vi.fn().mockResolvedValue({ status: 'disabled' }) }));
import { runPreviewCacheJanitor } from '../preview-cache-scheduler.js';
vi.mock('../projection/company-key-results.js', () => ({ runCompanyKrProjection: vi.fn(async () => ({ skipped: true })) }));
// 目录真实handler会开独立连接并访问Notion；此文件仅验证调度，行为由directory单元与真实PG测试覆盖。
vi.mock('../projection/directory-job.js', () => ({ runDirectoryJob: vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' }) }));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../node-onboarding/service.js', () => ({
  runNodeOnboardingJob: vi.fn().mockResolvedValue({ reconciled: 0, errors: 0, scheduled: 0 }),
  runNodeExecutionOnboardingJob: vi.fn().mockResolvedValue({ advanced: 0 }),
}));
import { runNodeOnboardingJob } from '../node-onboarding/service.js';

vi.mock('../daily-review-scheduler.js', () => ({
  triggerArchReview: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
  triggerCiPatrol: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
}));
vi.mock('../active-goals-zero-trigger.js', () => ({
  maybeTriggerStrategySession: vi.fn().mockResolvedValue({ created: false, reason: 'active_goals_present' }),
}));
vi.mock('../daily-backup-scheduler.js', () => ({
  scheduleDailyBackup: vi.fn().mockResolvedValue({ inWindow: false, triggered: false, alreadyDone: false }),
}));
vi.mock('../battle-report.js', () => ({
  maybeGenerateBattleReport: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
}));
vi.mock('../line-dreaming.js', () => ({
  maybeRunLineDreaming: vi.fn().mockResolvedValue({ created: false, reason: 'outside_window' }),
}));
vi.mock('../ledger-hygiene.js', () => ({
  maybeRunLedgerHygiene: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../capture-triage.js', () => ({
  runCaptureTriage: vi.fn().mockResolvedValue({ skipped: true, processed: 0, failed: 0 }),
}));
vi.mock('../receipt-collector.js', () => ({
  runReceiptCollector: vi.fn().mockResolvedValue({ skipped: true, timedOut: 0 }),
}));
vi.mock('../launchd-patrol.js', () => ({
  runLaunchdPatrol: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../direction-proposer.js', () => ({
  maybeRunDirectionProposer: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../postdeploy-verifier.js', () => ({
  runPostdeployVerifier: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../seven-ring-audit.js', () => ({
  runSevenRingAuditJob: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../guard-drill.js', () => ({
  runGuardDrill: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../morning-cockpit-bark.js', () => ({
  runMorningCockpitBark: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
}));
vi.mock('../cron/drift-sentinel.js', () => ({
  runDriftSentinel: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_not_reached' }),
}));
vi.mock('../promise-map-nightly.js', () => ({
  runPromiseMapNightly: vi.fn().mockResolvedValue({ ok: true, passed: 4, failed: 0 }),
}));

// disk-guard 真实 handler 会 ssh 逃逸宿主跑 df/worktree 收割——单测绝不能碰真机，
// 且本地跑会超时（多 worktree × ConnectTimeout 叠加 >30s）。行为由 disk-guard 自己的测试覆盖。
vi.mock('../cron/disk-guard.js', () => ({
  runDiskGuard: vi.fn().mockResolvedValue({ ok: true, pct: 50, level: 'ok' }),
}));

// machine-vitals 真实 handler 会走 execFile(docker/df) 系统调用——在 fake timers 下
// 不受 vi 的虚拟时钟驱动，会挂住整轮串行 job（machine-vitals 现排 JOBS 首位）。
// 其行为本身由 machine-vitals.test.js / machine-vitals-wiring.test.js 覆盖，这里纯 mock 掉。
vi.mock('../machine-vitals.js', () => ({
  sampleMachineVitals: vi.fn().mockResolvedValue({ sampled_at: Date.now(), error: null }),
}));

vi.mock('../codex-test-gen.js', () => ({
  runCodexTestGen: vi.fn().mockResolvedValue({ queued: [], count: 0 }),
}));

vi.mock('../capture-aging.js', () => ({
  runCaptureAging: vi.fn().mockResolvedValue({ skipped: false, overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0 }),
}));

// conversation-capture 真实 handler 会扫描本机 ~/.claude/projects 真实文件并调用
// pushCapture——在这个纯路由行为单测里必须 mock 掉，否则结果依赖本机磁盘状态
// 且会被 pushCapture 对假 pool（query 恒返回 {rows:[]}）的真实失败信号触发
// job 失败，这不是本测试想覆盖的东西（conversation-capture 自身逻辑由
// conversation-capture.test.js + integration 测试覆盖）。
vi.mock('../conversation-capture.js', () => ({
  runConversationCapture: vi.fn().mockResolvedValue({ ok: true, pushed: 0, errors: 0 }),
}));

vi.mock('../triage-officer-rank.js', () => ({
  maybeRunTriageOfficerRank: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
  LEADERBOARD_KEY: 'triage_officer_leaderboard',
}));

vi.mock('../triage-officer-15min.js', () => ({
  runTriageOfficer15min: vi.fn().mockResolvedValue({ skipped: true, merged: 0, autoApproved: 0 }),
}));

vi.mock('../conversation-ttl-archiver.js', () => ({
  runConversationTtlArchiver: vi.fn().mockResolvedValue({ skipped: true, archived: 0 }),
}));

vi.mock('../notion-capture-ingest.js', () => ({
  runNotionCaptureIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

vi.mock('../notion-inbox-push.js', () => ({
  runNotionProductPush: vi.fn().mockResolvedValue({ skipped: true, reason: 'empty_leaderboard' }),
}));

vi.mock('../notion-verdict-ingest.js', () => ({
  runNotionVerdictIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' }),
}));

vi.mock('../projection/commands.js', () => ({
  applyProjectionCommands: vi.fn().mockResolvedValue({ claimed: 0, applied: 0, rejected: 0, errors: 0 }),
}));

vi.mock('../projection/outbox.js', () => ({
  runProjectionOutbox: vi.fn().mockResolvedValue({ claimed: 0, done: 0, deferred: 0, failed: 0, dead: 0 }),
}));

vi.mock('../ops-model-accounts-collector.js', () => ({
  runModelAccountsCollector: vi.fn(async () => ({ collected: 0, results: [] })),
}));
vi.mock('../projection/notion.js', () => ({
  runNotionTaskCommandIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' }),
}));

// openclaw-agent 收割真实 handler 会 ssh 到执行机读 ~/brain-runs/<run_id>.exit——
// 与 disk-guard 同理：纯路由行为单测绝不碰真机，且假 pool 喂出来的 run_id 会让
// 每行都卡满 ssh ConnectTimeout，整轮串行 job 被拖垮。
// 收割逻辑本身由 openclaw-agent-executor.test.js 覆盖。
vi.mock('../openclaw-agent-executor.js', () => ({
  reapOpenclawAgentRuns: vi.fn().mockResolvedValue({ reaped: 0, completed: 0, failed: 0 }),
}));

// script 收割（棒 3）同理：真实 handler 会 ssh 到跑场机读 .exit，纯路由单测绝不碰真机；
// 收割逻辑由 script-executor.test.js / integration/script-executor-chain.pg.integration.test.js 覆盖。
vi.mock('../script-executor.js', () => ({
  reapLegacyScriptRuns: vi.fn().mockResolvedValue({ reaped: 0, completed: 0, failed: 0, retried: 0 }),
  reapManagedScriptRuns: vi.fn().mockResolvedValue({ reaped: 0, completed: 0, failed: 0, retried: 0 }),
}));

// 秋米设备对账的真实 handler 会扫库。「哨兵写入失败不影响 job 结果」那条用例的假 pool 对
// 所有 query 一律 reject，真 handler 会把那个 reject 变成 job 失败——验的是哨兵，却被对账带红。
// 与 openclaw-agent-reaper 同理：纯注册/路由行为单测不碰库。对账逻辑本体由 device-delegation.test.js 覆盖。
vi.mock('../routing/device-delegation.js', () => ({
  reconcileDelegatedDeviceJobs: vi.fn().mockResolvedValue({ checked: 0, completed: 0, failed: 0 }),
}));

// owner-decision-deadline 真实 handler 会查 tasks/开事务；行为由 integration/owner-decision-approval.pg.integration.test.js 覆盖，
// 这里只验注册（顺序/声明的活性尺子/needsPool）。
vi.mock('../owner-decision-deadline.js', () => ({
  runOwnerDecisionDeadline: vi.fn().mockResolvedValue({ skipped: true }),
}));

// backbone-contract-sync 真实 handler 会打 GitHub/Notion——单测绝不真发网络；行为由 activity-contract-sync.test.js 覆盖。
vi.mock('../activity-contract-sync.js', () => ({
  runBackboneContractJob: vi.fn().mockResolvedValue({ sync: { skipped: true }, push: null }),
}));

// skill-dist-drift 真实 handler 会 ssh 到 MMV/跑场机取清单——单测绝不真发 ssh；行为由 skill-dist-drift.test.js（注入假执行器）覆盖。
vi.mock('../skill-dist-drift.js', () => ({
  runSkillDistDrift: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

// skill-inventory-sync 真实 handler 会 ssh 到 MMV 跑采集程序——单测绝不真发 ssh；行为由 skill-inventory-sync.test.js 与 integration 覆盖。
// skill-registry-projection 真实 handler 会打 Notion——单测绝不真发网络；行为由 skill-registry-projection.test.js（假 Notion）覆盖。
vi.mock('../skill-registry-projection.js', () => ({
  runSkillRegistryProjection: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

vi.mock('../skill-inventory-sync.js', () => ({
  runSkillInventorySync: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

// recurring-tasks 真实 handler 会扫 recurring_tasks 并建单；行为由 recurring-engine.test.js（假库）
// 与 integration/recurring-engine.pg.integration.test.js（真库）覆盖，这里只验注册与接线。
vi.mock('../recurring.js', () => ({
  runRecurringTasksJob: vi.fn().mockResolvedValue({ checked: 0, created: [], baseline: 0, missed: 0 }),
}));

// alerting-flush 真实 handler 会读写 working_memory 并发飞书；持久化行为由 alerting-persist.test.js 覆盖，
// 这里只验注册与接线。部分 mock：保留 raise 等导出。
vi.mock('../alerting.js', async (importOriginal) => ({
  ...(await importOriginal()),
  flushAlertsIfNeeded: vi.fn().mockResolvedValue({ p1: false, p2: false }),
}));

// workflow-run-lost-deadline 真实 handler 会 ssh 执行机放锁/回桌面——单测绝不真发；行为由 workflow-run-lost-deadline.test.js 覆盖。
vi.mock('../workflow-run-lost-deadline.js', () => ({
  runWorkflowRunLostDeadline: vi.fn().mockResolvedValue({ scanned: 0, lost: 0 }),
}));

// commander-watchdog / workflow-trend-bark 真实 handler 会 ssh MMV 登记 escort 与发 Bark——单测绝不真发；行为由 commander-watchdog.test.js 覆盖。
vi.mock('../commander-watchdog.js', () => ({
  runCommanderWatchdog: vi.fn().mockResolvedValue({ scanned: 0, relaunched: 0, barked: 0 }),
  runWorkflowTrendBark: vi.fn().mockResolvedValue({ skipped: 'outside_window' }),
}));

vi.mock('../ops-scheduler-liveness.js', () => ({
  runSchedulerLiveness: vi.fn().mockResolvedValue({ ok: true, jobs: 0, flippedDead: 0, recovered: 0 }),
}));

// ops-collector / openclaw-guards 真实 handler 会 ssh 逃逸 + execFileSync docker（后者甚至会 docker restart 生产网关）——
// 单测绝不能碰真机；行为由各自的测试覆盖。部分 mock：只替换 handler，保留其它导出给 notion-push-sync 等模块用。
vi.mock('../ops-collector.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runOpsCollector: vi.fn().mockResolvedValue({ skipped: true }),
}));
// openclaw-run-ingest 真实 handler 会 ssh mmv 读 sqlite——单测绝不碰真机；采集逻辑由 openclaw-run-ingest.test.js 覆盖。
vi.mock('../openclaw-run-ingest.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runOpenclawRunIngest: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../openclaw-guards.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runOpenclawGuards: vi.fn().mockResolvedValue({ skipped: true }),
}));

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
import { runDirectoryJob } from '../projection/directory-job.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('scheduler-jobs 注册表', () => {
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
