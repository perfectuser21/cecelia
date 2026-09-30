/**
 * external-run-mirror-liveness.test.js — 外部 run 镜像不得被 liveness 探针零证据回队（任务 0004aceb，决策 3c98fb36 阶段1）
 *
 * 09-30 生产实证（task_events，北京时间）：device_job 镜像 1e84cbad 被 watchdog_headed_requeue
 * reason=no_spawn_evidence 回队 5 次（18:45/18:55/19:05/19:17/19:33），69af4667 / da9a9886 同样。
 * 这些镜像由 ZenithJoy brain-device-job-mirror（wall-report → Brain）为执行机上 cron/wf-run 采收批建，
 * payload.source='cron'，从不 claim、Brain 从不 spawn：本机三条 spawn 证据天然为空。
 * 探针里两道豁免都没接住它：
 *   - 认领新鲜度分支要求 claimed_by/claimed_at 非空（镜像单为 NULL）；
 *   - 外部执行体豁免 `isExternallyExecuted && !EXTERNAL_WATCHDOG_TYPES` 明确把 device_job 排除；
 *   - workflow_run 根本不在 EXTERNALLY_EXECUTED_TASK_TYPES。
 * 于是直落零证据安全回队：UPDATE 清 started_at → workflow-run-lost-deadline（按起跑 4h+30m）永远算不到，
 * commander-watchdog（起跑 ≥15min）判据被重置；wall-report 阶段回执又把它设回 in_progress → 振荡。
 *
 * 契约：
 *   1. 镜像心跳新鲜（task_runs 阶段回执 / commander 心跳 / updated_at 任一 ≤ 阈值）→ 保持 in_progress，
 *      不回队、不清 started_at、不写 watchdog_*_requeue。
 *   2. 心跳陈旧（> 阈值）也不回队，只记一条 task_events external_liveness_stale（同一陈旧窗口只记一次），
 *      交给 lost-deadline / commander-watchdog 处理。
 *   3. 既有行为不动：claimed 的领单器 device_job（非 cron）认领超龄仍走 0923 回队路径；headed_manual dev 任务
 *      零证据仍安全回队（铁律 9f14c074）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '0\n'),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

let probeTaskLiveness, suspectProcesses, externalStaleNoted;

beforeAll(async () => {
  vi.resetModules();
  const executor = await import('../executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  suspectProcesses = executor.suspectProcesses;
  externalStaleNoted = executor.externalStaleNoted;
});

const MIN = 60 * 1000;
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();

/** 镜像单：brain-device-job-mirror 建出来的行（payload 形状按 09-30 生产库 1e84cbad 原样） */
function makeMirrorTask(overrides = {}, payloadOverrides = {}) {
  return {
    id: '1e84cbad-feb0-4496-9d50-92a691b69884',
    title: '获客采收 · ANGYVB4227006983',
    task_type: 'device_job',
    executor_kind: null,
    status: 'in_progress',
    claimed_by: null,
    claimed_at: null,
    started_at: agoIso(20 * MIN),
    updated_at: agoIso(20 * MIN),
    last_run_activity_at: null,
    error_message: null,
    payload: {
      source: 'cron',
      serial: 'ANGYVB4227006983',
      headed_manual: true,
      executed_at: agoIso(20 * MIN),
      idempotency_key: 'c8641c32-506a-4e11-bb5b-78db6f06baae',
      ...payloadOverrides,
    },
    ...overrides,
  };
}

/** 让 probe 直接进入「第二次探针失败」分支（双确认已过） */
function markSuspect(taskId) {
  suspectProcesses.set(taskId, { firstSeen: agoIso(5 * MIN), tickCount: 1 });
}

function requeueCalls(taskId) {
  return mockPool.query.mock.calls.filter(
    ([sql, params]) => /UPDATE tasks SET status = 'queued'/.test(sql) && params?.[0] === taskId,
  );
}

function eventCalls(taskId, eventType) {
  return mockPool.query.mock.calls.filter(
    ([sql, params]) => /INSERT INTO task_events/.test(sql) && params?.[0] === taskId && params?.[1] === eventType,
  );
}

async function probeWith(rows) {
  mockPool.query.mockReset();
  mockPool.query.mockImplementation(async (sql) => {
    if (/FROM tasks\s+WHERE status = 'in_progress'/.test(sql)) return { rows };
    return { rows: [], rowCount: 0 };
  });
  return probeTaskLiveness();
}

describe('外部 run 镜像（device_job source=cron / workflow_run）不得零证据回队', () => {
  beforeEach(() => {
    suspectProcesses.clear();
    externalStaleNoted?.clear?.();
  });

  it('device_job 镜像：wall-report 阶段回执新鲜（3 分钟前）→ 保持 in_progress，不回队、不清 started_at', async () => {
    const task = makeMirrorTask({ last_run_activity_at: agoIso(3 * MIN) });
    markSuspect(task.id);

    const actions = await probeWith([task]);

    expect(requeueCalls(task.id)).toHaveLength(0);
    expect(eventCalls(task.id, 'watchdog_headed_requeue')).toHaveLength(0);
    expect(eventCalls(task.id, 'watchdog_safe_requeue')).toHaveLength(0);
    expect(actions.filter((a) => a.task_id === task.id)).toHaveLength(0);
    expect(suspectProcesses.has(task.id)).toBe(false);
  });

  it('device_job 镜像：仅 commander 心跳新鲜（payload.commander_heartbeat_at）也算活', async () => {
    const task = makeMirrorTask({}, { commander_heartbeat_at: agoIso(4 * MIN) });
    markSuspect(task.id);

    await probeWith([task]);

    expect(requeueCalls(task.id)).toHaveLength(0);
    expect(eventCalls(task.id, 'external_liveness_stale')).toHaveLength(0);
  });

  it('device_job 镜像：心跳陈旧（40 分钟无回执）→ 仍不回队，只记 external_liveness_stale 一次', async () => {
    const task = makeMirrorTask({
      started_at: agoIso(60 * MIN),
      updated_at: agoIso(40 * MIN),
      last_run_activity_at: agoIso(40 * MIN),
    }, { executed_at: agoIso(60 * MIN) });
    markSuspect(task.id);

    await probeWith([task]);
    expect(requeueCalls(task.id)).toHaveLength(0);
    expect(eventCalls(task.id, 'watchdog_headed_requeue')).toHaveLength(0);
    const stale = eventCalls(task.id, 'external_liveness_stale');
    expect(stale).toHaveLength(1);
    const payload = JSON.parse(stale[0][1][2]);
    expect(payload.reason).toBe('heartbeat_stale');
    expect(payload.stale_minutes).toBeGreaterThanOrEqual(39);

    // 同一陈旧窗口内再探一轮：不重复留痕、依旧不回队
    mockPool.query.mock.calls.length = 0;
    markSuspect(task.id);
    await probeTaskLiveness();
    expect(requeueCalls(task.id)).toHaveLength(0);
    expect(eventCalls(task.id, 'external_liveness_stale')).toHaveLength(0);
  });

  it('workflow_run（Notion ssh 直派镜像）：零 spawn 证据也不回队', async () => {
    const task = makeMirrorTask({
      id: 'da9a9886-e969-4e9b-ab11-b9109ebd2662',
      task_type: 'workflow_run',
      last_run_activity_at: agoIso(2 * MIN),
    }, { source: undefined, headed_manual: undefined });
    markSuspect(task.id);

    await probeWith([task]);

    expect(requeueCalls(task.id)).toHaveLength(0);
    expect(eventCalls(task.id, 'watchdog_safe_requeue')).toHaveLength(0);
    expect(suspectProcesses.has(task.id)).toBe(false);
  });
});

describe('既有行为不受影响', () => {
  beforeEach(() => {
    suspectProcesses.clear();
    externalStaleNoted?.clear?.();
  });

  it('领单器 device_job（非 cron，claimed 60 分钟无回执）仍走 0923 认领超龄 → 零证据安全回队', async () => {
    const task = makeMirrorTask({
      id: 'e8c1dbce-0000-4000-8000-000000000001',
      claimed_by: 'worker-xian-m4',
      claimed_at: agoIso(60 * MIN),
      started_at: agoIso(60 * MIN),
      updated_at: agoIso(60 * MIN),
    }, { source: 'worker-claim', headed_manual: undefined });
    markSuspect(task.id);

    await probeWith([task]);

    expect(requeueCalls(task.id)).toHaveLength(1);
    expect(eventCalls(task.id, 'watchdog_safe_requeue')).toHaveLength(1);
  });

  it('headed_manual dev 任务零证据仍安全回队（铁律 9f14c074）', async () => {
    const task = {
      id: '2fc3b6fc-0000-4000-8000-000000000002',
      title: 'dev headed',
      task_type: 'dev',
      executor_kind: null,
      status: 'in_progress',
      claimed_by: 'interactive-dev-skill',
      claimed_at: agoIso(30 * MIN),
      started_at: agoIso(30 * MIN),
      updated_at: agoIso(30 * MIN),
      last_run_activity_at: null,
      error_message: null,
      payload: { headed_manual: 'true' },
    };
    markSuspect(task.id);

    await probeWith([task]);

    expect(requeueCalls(task.id)).toHaveLength(1);
    expect(eventCalls(task.id, 'watchdog_headed_requeue')).toHaveLength(1);
  });
});
