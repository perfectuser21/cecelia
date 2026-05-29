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
