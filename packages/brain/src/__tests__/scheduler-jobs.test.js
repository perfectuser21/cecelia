import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  runSchedulerJobsOnce,
  startSchedulerJobsLoop,
  stopSchedulerJobsLoop,
  JOBS,
  SENTINEL_KEY_PREFIX,
} from '../scheduler-jobs.js';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('JOBS 注册了正确数量的 job（含 triage-officer-rank + triage-officer-15min + conversation-ttl-archiver）', () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toContain('triage-officer-rank');
    expect(names).toContain('triage-officer-15min');
    expect(names).toContain('conversation-ttl-archiver');
    expect(names).toContain('conversation-capture');
    // conversation-ttl-archiver 排在 conversation-capture 之后
    expect(names.indexOf('conversation-ttl-archiver')).toBeGreaterThan(names.indexOf('conversation-capture'));
  });

  it('runSchedulerJobsOnce 调用全部 job，needsPool 决定传参', async () => {
    const pool = makePool();
    const results = await runSchedulerJobsOnce(pool);
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
