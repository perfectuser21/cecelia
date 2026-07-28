/**
 * harness-initiative-patrol.test.js — WS4 单测
 *
 * 验证 Harness Initiative Patrol：
 *   - 扫 initiative_runs WHERE completed_at IS NULL
 *   - Planner 卡住阈值 15min / GAN 每轮卡住阈值 20min
 *   - 超阈值在 tasks 表创建 harness_intervention 任务
 *   - 防重：同一 initiative 已有 queued/in_progress/pending 的 harness_intervention 任务则跳过
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

const {
  runHarnessInitiativePatrol,
  PLANNER_STUCK_MS,
  GAN_ROUND_STUCK_MS,
} = await import('../harness-initiative-patrol.js');

const MIN = 60 * 1000;
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * 按 SQL 内容路由 mock 响应。
 * 顺序敏感：INSERT 先于 SELECT 判定，避免 harness_intervention 子串误命中。
 */
function routeMock(opts) {
  const {
    runs = [],
    ganEvent = null,
    dedupRows = [],
    insertId = 'task-new',
  } = opts;
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('INSERT INTO tasks')) {
      return Promise.resolve({ rows: [{ id: insertId }] });
    }
    if (sql.includes('initiative_run_events')) {
      return Promise.resolve({ rows: ganEvent ? [ganEvent] : [] });
    }
    if (sql.includes('harness_intervention')) {
      // dedup SELECT
      return Promise.resolve({ rows: dedupRows });
    }
    if (sql.includes('completed_at IS NULL')) {
      // 主扫描
      return Promise.resolve({ rows: runs });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('阈值常量', () => {
  it('Planner 卡住阈值 = 15 分钟', () => {
    expect(PLANNER_STUCK_MS).toBe(15 * 60 * 1000);
  });
  it('GAN 每轮卡住阈值 = 20 分钟', () => {
    expect(GAN_ROUND_STUCK_MS).toBe(20 * 60 * 1000);
  });
});

describe('主扫描 SQL', () => {
  it('扫描 initiative_runs 且过滤 completed_at IS NULL', async () => {
    routeMock({ runs: [] });
    const r = await runHarnessInitiativePatrol();
    expect(r.scanned).toBe(0);
    const scanSql = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('FROM initiative_runs')
    )?.[0];
    expect(scanSql).toBeTruthy();
    expect(scanSql).toContain('completed_at IS NULL');
  });
});

describe('Planner 卡住检测', () => {
  it('阶段 A 停留超过 15min → 创建 harness_intervention 任务', async () => {
    routeMock({
      runs: [
        {
          id: 'run-1',
          initiative_id: 'init-1',
          phase: 'A_contract',
          started_at: agoIso(20 * MIN),
          updated_at: agoIso(20 * MIN),
          completed_at: null,
        },
      ],
      ganEvent: null,
      dedupRows: [],
      insertId: 'task-1',
    });

    const r = await runHarnessInitiativePatrol();
    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(1);
    expect(r.intervened).toBe(1);

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[0]).toContain("'harness_intervention'");
    // payload 含 initiative_id
    expect(insertCall[1].some((p) => String(p).includes('init-1'))).toBe(true);
  });

  it('阶段 A 停留未超过 15min → 不创建任务', async () => {
    routeMock({
      runs: [
        {
          id: 'run-2',
          initiative_id: 'init-2',
          phase: 'A_contract',
          started_at: agoIso(5 * MIN),
          updated_at: agoIso(5 * MIN),
          completed_at: null,
        },
      ],
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeFalsy();
  });
});

describe('GAN 每轮卡住检测', () => {
  it('GAN 轮次进行中超过 20min → 创建 harness_intervention 任务', async () => {
    routeMock({
      runs: [
        {
          id: 'run-3',
          initiative_id: 'init-3',
          phase: 'B_task_loop',
          started_at: agoIso(40 * MIN),
          updated_at: agoIso(2 * MIN), // 近期有更新 → planner 不触发
          completed_at: null,
        },
      ],
      ganEvent: {
        node: 'reviewer',
        status: 'running',
        created_at: agoIso(25 * MIN),
      },
      dedupRows: [],
      insertId: 'task-3',
    });

    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(1);
    expect(r.intervened).toBe(1);
    expect(r.details[0].kind).toBe('gan_round');
  });

  it('GAN 轮次已完成（status=completed）不算卡住', async () => {
    routeMock({
      runs: [
        {
          id: 'run-4',
          initiative_id: 'init-4',
          phase: 'B_task_loop',
          started_at: agoIso(40 * MIN),
          updated_at: agoIso(2 * MIN),
          completed_at: null,
        },
      ],
      ganEvent: {
        node: 'reviewer',
        status: 'completed',
        created_at: agoIso(25 * MIN),
      },
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
  });
});

describe('防重逻辑', () => {
  it('同一 initiative 已有 queued harness_intervention 任务则跳过创建', async () => {
    routeMock({
      runs: [
        {
          id: 'run-5',
          initiative_id: 'init-5',
          phase: 'A_contract',
          started_at: agoIso(30 * MIN),
          updated_at: agoIso(30 * MIN),
          completed_at: null,
        },
      ],
      ganEvent: null,
      dedupRows: [{ id: 'existing-intervention' }],
    });

    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(1);
    expect(r.intervened).toBe(0);

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeFalsy();

    // 防重 SQL 必须覆盖 queued/in_progress/pending
    const dedupSql = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('harness_intervention') &&
        !c[0].includes('INSERT INTO tasks')
    )?.[0];
    expect(dedupSql).toBeTruthy();
    expect(dedupSql).toContain('queued');
    expect(dedupSql).toContain('in_progress');
    expect(dedupSql).toContain('pending');
  });
});

// ─── 刀3：Kernel v1 GAN 轮次可见性 ────────────────────────────────────────
// Kernel v1（tasks.payload.harness_runtime='kernel-v1'）每个 planner/proposer/reviewer/
// generator/evaluator/judge 写一条 harness_attempts 行（唯一键 run_id+hop），
// 对 initiative_run_events 零引用。巡检若只查 initiative_run_events，
// 对 Kernel run 就是永久退化 → GAN 轮次卡死无人管（2026-07-26 实证）。
describe('Kernel v1 GAN 轮次卡死检测（harness_attempts）', () => {
  const kernelRun = (over = {}) => ({
    id: 'run-k1',
    initiative_id: 'init-k1',
    phase: 'planning', // kernel run 全程 phase='planning'，phase 判据对它恒不触发
    started_at: agoIso(90 * MIN),
    updated_at: agoIso(1 * MIN),
    completed_at: null,
    harness_runtime: 'kernel-v1',
    ...over,
  });

  function routeKernel({ run, attempt = null, dedupRows = [], insertId = 'task-k', attemptsError = null }) {
    mockQuery.mockImplementation((sql) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO tasks')) return Promise.resolve({ rows: [{ id: insertId }] });
      if (sql.includes('harness_attempts')) {
        if (attemptsError) return Promise.reject(new Error(attemptsError));
        return Promise.resolve({ rows: attempt ? [attempt] : [] });
      }
      if (sql.includes('walking_skeleton_thread_lookup')) return Promise.resolve({ rows: [] });
      if (sql.includes('initiative_run_events')) return Promise.resolve({ rows: [] });
      if (sql.includes('harness_intervention')) return Promise.resolve({ rows: dedupRows });
      if (sql.includes('completed_at IS NULL')) return Promise.resolve({ rows: [run] });
      return Promise.resolve({ rows: [] });
    });
  }

  const attemptsCalls = () =>
    mockQuery.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('harness_attempts'));
  const eventCalls = () =>
    mockQuery.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('initiative_run_events'));

  beforeEach(() => mockQuery.mockReset());

  it('主扫描 SQL 纳管 kernel-v1 run（不被 v2 过滤器整体排除）', async () => {
    routeKernel({ run: kernelRun() });
    const r = await runHarnessInitiativePatrol();
    expect(r.scanned).toBe(1);

    const scanSql = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('FROM initiative_runs')
    )?.[0];
    expect(scanSql).toContain('completed_at IS NULL');
    expect(scanSql).toContain('harness_runtime');
    expect(scanSql).toContain('kernel-v1');
  });

  it('最新 hop 是 reviewer/running 且超 20min → gan_round 卡死 + 建 intervention 任务', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: {
        hop: 18,
        role: 'reviewer',
        status: 'running',
        created_at: agoIso(26 * MIN),
        started_at: agoIso(25 * MIN),
      },
      insertId: 'task-kernel-gan',
    });

    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(1);
    expect(r.intervened).toBe(1);
    expect(r.details[0].kind).toBe('gan_round');

    // 用 run_id（不是 initiative_id）查 harness_attempts
    const call = attemptsCalls()[0];
    expect(call).toBeTruthy();
    expect(call[1]).toContain('run-k1');

    // intervention payload 带 kind=gan_round
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    const payloadJson = insertCall[1].find((p) => typeof p === 'string' && p.includes('initiative_id'));
    expect(JSON.parse(payloadJson).kind).toBe('gan_round');
    expect(JSON.parse(payloadJson).initiative_id).toBe('init-k1');
    expect(JSON.parse(payloadJson).run_id).toBe('run-k1');
    expect(JSON.parse(payloadJson).harness_runtime).toBe('kernel-v1');
    expect(mockQuery.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('walking_skeleton_thread_lookup')
    )).toBe(false);
  });

  it('kernel run 的 GAN 活性只从 harness_attempts 推导，不查 initiative_run_events', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: { hop: 18, role: 'reviewer', status: 'running', created_at: agoIso(26 * MIN), started_at: agoIso(25 * MIN) },
    });
    await runHarnessInitiativePatrol();
    expect(attemptsCalls().length).toBeGreaterThan(0);
    expect(eventCalls().length).toBe(0);
  });

  it('最新 hop 已终态（completed_with_concerns）→ 不算卡住', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: {
        hop: 15,
        role: 'reviewer',
        status: 'completed_with_concerns',
        created_at: agoIso(60 * MIN),
        started_at: agoIso(60 * MIN),
      },
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
  });

  it('最新 hop 是 generator（长跑合法）→ 超 20min 也不误报', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: {
        hop: 20,
        role: 'generator',
        status: 'running',
        created_at: agoIso(120 * MIN),
        started_at: agoIso(120 * MIN),
      },
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
  });

  it('最新 hop 是 planner/running 超 15min → planner 卡死（沿用 PLANNER_STUCK_MS）', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: {
        hop: 1,
        role: 'planner',
        status: 'running',
        created_at: agoIso(18 * MIN),
        started_at: agoIso(18 * MIN),
      },
      insertId: 'task-kernel-planner',
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(1);
    expect(r.details[0].kind).toBe('planner');
    expect(r.details[0].elapsedMs).toBeGreaterThan(PLANNER_STUCK_MS);
  });

  it('planner running 未超 15min → 不算卡住', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: {
        hop: 1,
        role: 'planner',
        status: 'running',
        created_at: agoIso(5 * MIN),
        started_at: agoIso(5 * MIN),
      },
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(0);
  });

  it('最新 hop 无时间戳（预留行）→ 不算卡住', async () => {
    routeKernel({
      run: kernelRun(),
      attempt: { hop: 19, role: 'reviewer', status: 'queued', created_at: null, started_at: null },
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
  });

  it('harness_attempts 查询异常 → 吞掉不冒泡（失败非致命不变量）', async () => {
    routeKernel({ run: kernelRun(), attemptsError: 'relation "harness_attempts" does not exist' });
    const r = await runHarnessInitiativePatrol();
    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(0);
    expect(r.intervened).toBe(0);
  });

  it('旧 relay 路径回归：非 kernel run 仍走 initiative_run_events，不碰 harness_attempts', async () => {
    routeKernel({
      run: {
        id: 'run-legacy',
        initiative_id: 'init-legacy',
        phase: 'A_contract',
        started_at: agoIso(30 * MIN),
        updated_at: agoIso(30 * MIN),
        completed_at: null,
        harness_runtime: null,
      },
      insertId: 'task-legacy',
    });
    const r = await runHarnessInitiativePatrol();
    expect(r.stuck).toBe(1);
    expect(r.details[0].kind).toBe('planner');
    expect(eventCalls().length).toBeGreaterThan(0);
    expect(attemptsCalls().length).toBe(0);
  });
});

describe('plugin 集成', () => {
  it('pipeline-patrol-plugin.js 调用 harnessInitiativePatrol', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../pipeline-patrol-plugin.js'),
      'utf8'
    );
    expect(src).toMatch(/runHarnessInitiativePatrol/);
  });
});

// Slice5: intervention 任务必须带在飞容器 id，否则 handleIntervention 永远 no_container_id→纯 alert，
// 无法读 docker logs 做真诊断/干预。createInterventionTask 查 thread_lookup 拿在飞容器塞进 payload。
describe('Slice5: intervention payload 带 container_id', () => {
  beforeEach(() => mockQuery.mockReset());

  it('查 thread_lookup 在飞容器 → 塞进 INSERT payload.container_id', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO tasks')) return Promise.resolve({ rows: [{ id: 'task-ci' }] });
      if (sql.includes('walking_skeleton_thread_lookup')) return Promise.resolve({ rows: [{ container_id: 'harness-task-init1-r0-abcd' }] });
      if (sql.includes('initiative_run_events')) return Promise.resolve({ rows: [] });
      if (sql.includes('harness_intervention')) return Promise.resolve({ rows: [] }); // dedup 空
      if (sql.includes('completed_at IS NULL')) return Promise.resolve({ rows: [
        { id: 'run-ci', initiative_id: 'init-1', phase: 'A_contract', started_at: agoIso(20 * MIN), updated_at: agoIso(20 * MIN), completed_at: null },
      ] });
      return Promise.resolve({ rows: [] });
    });

    const r = await runHarnessInitiativePatrol();
    expect(r.intervened).toBe(1);

    // 确实查了 thread_lookup，用 initiativeId
    const lookupCall = mockQuery.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('walking_skeleton_thread_lookup'));
    expect(lookupCall).toBeTruthy();
    expect(lookupCall[1].some((p) => String(p).includes('init-1'))).toBe(true);

    // payload.container_id 被塞入
    const insertCall = mockQuery.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks'));
    const payloadJson = insertCall[1].find((p) => typeof p === 'string' && p.includes('initiative_id'));
    expect(JSON.parse(payloadJson).container_id).toBe('harness-task-init1-r0-abcd');
  });

  it('thread_lookup 无在飞容器 → payload.container_id=null（降级，不报错仍建任务）', async () => {
    mockQuery.mockImplementation((sql) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO tasks')) return Promise.resolve({ rows: [{ id: 'task-ci2' }] });
      if (sql.includes('walking_skeleton_thread_lookup')) return Promise.resolve({ rows: [] });
      if (sql.includes('initiative_run_events')) return Promise.resolve({ rows: [] });
      if (sql.includes('harness_intervention')) return Promise.resolve({ rows: [] });
      if (sql.includes('completed_at IS NULL')) return Promise.resolve({ rows: [
        { id: 'run-ci2', initiative_id: 'init-2', phase: 'A_contract', started_at: agoIso(20 * MIN), updated_at: agoIso(20 * MIN), completed_at: null },
      ] });
      return Promise.resolve({ rows: [] });
    });

    await runHarnessInitiativePatrol();
    const insertCall = mockQuery.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks'));
    const payloadJson = insertCall[1].find((p) => typeof p === 'string' && p.includes('initiative_id'));
    expect(JSON.parse(payloadJson).container_id).toBeNull();
  });
});
