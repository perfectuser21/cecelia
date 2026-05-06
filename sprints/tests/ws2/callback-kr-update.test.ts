/**
 * Workstream 2 — F3 回血回填（callback → KR +1%）BEHAVIOR 测试
 *
 * 目标函数: incrementKRProgressByOnePercent(krId)
 * 实现位置: packages/brain/src/progress-reviewer.js
 * callback 接通: packages/brain/src/callback-processor.js（task=completed + pr_url + kr_id 三齐全 → 调用一次）
 *
 * 红阶段：函数未导出 → import 失败；callback 调用未接通 → 计数不匹配
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

const incrementMock = vi.fn();
// 注意：此 mock 仅用于 callback-processor 接通校验场景。
// 导出存在性校验（it: exports incrementKRProgressByOnePercent）走 importActual 绕过 mock。
vi.mock('../../../packages/brain/src/progress-reviewer.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    incrementKRProgressByOnePercent: incrementMock,
  };
});

vi.mock('../../../packages/brain/src/thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../../../packages/brain/src/decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../../packages/brain/src/embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
vi.mock('../../../packages/brain/src/events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../../../packages/brain/src/event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../../../packages/brain/src/circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ notifyTaskCompleted: vi.fn() }));
vi.mock('../../../packages/brain/src/alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../../../packages/brain/src/quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  QUARANTINE_REASONS: {},
}));
vi.mock('../../../packages/brain/src/desire-feedback.js', () => ({ updateDesireFromTask: vi.fn() }));
vi.mock('../../../packages/brain/src/routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
}));

describe('Workstream 2 — incrementKRProgressByOnePercent [BEHAVIOR]', () => {
  let progressReviewer: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    progressReviewer = await import('../../../packages/brain/src/progress-reviewer.js');
  });

  it('exports incrementKRProgressByOnePercent from progress-reviewer.js (real module, importActual bypasses mock)', async () => {
    const real: any = await vi.importActual('../../../packages/brain/src/progress-reviewer.js');
    expect(real.incrementKRProgressByOnePercent).toBeDefined();
    expect(typeof real.incrementKRProgressByOnePercent).toBe('function');
  });

  it('completed task with kr_id (kr at 50) → KR progress 升至 51', async () => {
    // 重新 import 真实函数（不走 mock），用 db pool mock 模拟数据
    vi.resetModules();
    const dbMod = await vi.importActual<any>('../../../packages/brain/src/db.js').catch(() => null);
    // 用真实 progress-reviewer 实现
    vi.doMock('../../../packages/brain/src/db.js', () => ({
      default: {
        query: vi.fn().mockImplementation((sql: string) => {
          if (/SELECT/i.test(sql) && /progress/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 50 }] });
          }
          if (/UPDATE/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 51 }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      },
    }));
    vi.doUnmock('../../../packages/brain/src/progress-reviewer.js');
    const real = await import('../../../packages/brain/src/progress-reviewer.js');
    const realPool = (await import('../../../packages/brain/src/db.js')).default as any;

    const result = await real.incrementKRProgressByOnePercent('kr-123');
    expect(result).toBeDefined();
    expect(result.progress).toBe(51);
    const updateCall = realPool.query.mock.calls.find((args: any[]) =>
      /UPDATE/i.test(args[0]) && /progress/i.test(args[0]),
    );
    expect(updateCall).toBeDefined();
  });

  it('completed task with kr_id (kr at 100) → KR progress 仍为 100，不溢出', async () => {
    vi.resetModules();
    vi.doMock('../../../packages/brain/src/db.js', () => ({
      default: {
        query: vi.fn().mockImplementation((sql: string) => {
          if (/SELECT/i.test(sql) && /progress/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 100 }] });
          }
          if (/UPDATE/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 100 }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      },
    }));
    vi.doUnmock('../../../packages/brain/src/progress-reviewer.js');
    const real = await import('../../../packages/brain/src/progress-reviewer.js');
    const result = await real.incrementKRProgressByOnePercent('kr-100');
    expect(result.progress).toBe(100);
  });

  it('completed task with kr_id (kr at 99) → KR progress 升至 100', async () => {
    vi.resetModules();
    vi.doMock('../../../packages/brain/src/db.js', () => ({
      default: {
        query: vi.fn().mockImplementation((sql: string) => {
          if (/SELECT/i.test(sql) && /progress/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 99 }] });
          }
          if (/UPDATE/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 100 }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      },
    }));
    vi.doUnmock('../../../packages/brain/src/progress-reviewer.js');
    const real = await import('../../../packages/brain/src/progress-reviewer.js');
    const result = await real.incrementKRProgressByOnePercent('kr-99');
    expect(result.progress).toBe(100);
  });

  it('completed task without kr_id → callback-processor 引用了 incrementKRProgressByOnePercent 但未调用本次', async () => {
    // Red 锚点：callback-processor.js 必须 import 该函数（源代码 grep）；运行时 kr_id=null → 不调用
    const fs = await import('node:fs');
    const cbSrc = fs.readFileSync('/workspace/packages/brain/src/callback-processor.js', 'utf8');
    expect(cbSrc).toMatch(/incrementKRProgressByOnePercent/);

    incrementMock.mockClear();
    const callbackMod = await import('../../../packages/brain/src/callback-processor.js');
    const dbMod = (await import('../../../packages/brain/src/db.js')).default as any;
    dbMod.query.mockResolvedValue({
      rows: [{ id: 't1', status: 'completed', kr_id: null }],
      rowCount: 1,
    });

    await callbackMod.processExecutionCallback(
      { task_id: 't1', status: 'completed', pr_url: 'https://github.com/x/y/pull/1' },
      dbMod,
    ).catch(() => {});
    expect(incrementMock).not.toHaveBeenCalled();
  });

  it('completed task without pr_url → callback-processor 引用了 incrementKRProgressByOnePercent 但未调用本次', async () => {
    // Red 锚点：callback-processor.js 必须 import 该函数（源代码 grep）；运行时 pr_url=null → 不调用
    const fs = await import('node:fs');
    const cbSrc = fs.readFileSync('/workspace/packages/brain/src/callback-processor.js', 'utf8');
    expect(cbSrc).toMatch(/incrementKRProgressByOnePercent/);

    incrementMock.mockClear();
    const callbackMod = await import('../../../packages/brain/src/callback-processor.js');
    const dbMod = (await import('../../../packages/brain/src/db.js')).default as any;
    dbMod.query.mockResolvedValue({
      rows: [{ id: 't2', status: 'completed', kr_id: 'kr-x' }],
      rowCount: 1,
    });

    await callbackMod.processExecutionCallback(
      { task_id: 't2', status: 'completed', pr_url: null },
      dbMod,
    ).catch(() => {});
    expect(incrementMock).not.toHaveBeenCalled();
  });

  it('callback-processor 在 task=completed + pr_url + kr_id 三齐全时调用 incrementKRProgressByOnePercent 一次', async () => {
    incrementMock.mockClear();
    const callbackMod = await import('../../../packages/brain/src/callback-processor.js');
    const dbMod = (await import('../../../packages/brain/src/db.js')).default as any;
    // 当前 DB 中 task.status 还不是 completed（pending），允许首次回血
    dbMod.query.mockResolvedValue({
      rows: [{ id: 't3', status: 'pending', kr_id: 'kr-y' }],
      rowCount: 1,
    });

    await callbackMod.processExecutionCallback(
      {
        task_id: 't3',
        status: 'completed',
        pr_url: 'https://github.com/x/y/pull/123',
      },
      dbMod,
    ).catch(() => {});
    expect(incrementMock).toHaveBeenCalledTimes(1);
    expect(incrementMock).toHaveBeenCalledWith('kr-y');
  });

  it('incrementKRProgressByOnePercent 使用单语句原子 SQL（含 LEAST(...,100) 表达式，无前置 SELECT）', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('../../../packages/brain/src/db.js', () => ({
      default: {
        query: vi.fn().mockImplementation((sql: string) => {
          calls.push(sql);
          if (/UPDATE/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 51 }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      },
    }));
    vi.doUnmock('../../../packages/brain/src/progress-reviewer.js');
    const real = await import('../../../packages/brain/src/progress-reviewer.js');
    await real.incrementKRProgressByOnePercent('kr-atomic');

    // 必须只有 UPDATE 语句被下发（禁止 read-modify-write 模式中的前置 SELECT）
    const selectCalls = calls.filter((s) => /^\s*SELECT\b/i.test(s));
    expect(selectCalls.length).toBe(0);
    // 必须有 UPDATE 且包含 LEAST(...,100) 原子表达式
    const updateCalls = calls.filter((s) => /UPDATE/i.test(s));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const atomicHit = updateCalls.find((s) => /LEAST\s*\([^)]*100\s*\)/i.test(s));
    expect(atomicHit).toBeDefined();
  });

  it('两次并发调用 incrementKRProgressByOnePercent 触发两条独立 UPDATE 调用（不依赖中间 SELECT 状态）', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('../../../packages/brain/src/db.js', () => ({
      default: {
        query: vi.fn().mockImplementation((sql: string) => {
          calls.push(sql);
          if (/UPDATE/i.test(sql)) {
            return Promise.resolve({ rows: [{ progress: 51 }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      },
    }));
    vi.doUnmock('../../../packages/brain/src/progress-reviewer.js');
    const real = await import('../../../packages/brain/src/progress-reviewer.js');

    await Promise.all([
      real.incrementKRProgressByOnePercent('kr-concurrent'),
      real.incrementKRProgressByOnePercent('kr-concurrent'),
    ]);
    const updateCalls = calls.filter((s) => /UPDATE/i.test(s));
    expect(updateCalls.length).toBe(2);
  });

  it('callback 重放幂等：DB 中 task.status 已是 completed → 不再调用 incrementKRProgressByOnePercent', async () => {
    // Red 锚点 1：callback-processor.js 必须先引用 incrementKRProgressByOnePercent
    const fs = await import('node:fs');
    const cbSrc = fs.readFileSync('/workspace/packages/brain/src/callback-processor.js', 'utf8');
    expect(cbSrc).toMatch(/incrementKRProgressByOnePercent/);
    // Red 锚点 2：必须含幂等短路文本（DB 已 completed 时早返回）
    expect(cbSrc).toMatch(/already.*completed|already_completed|status\s*===\s*['"]completed['"]/i);

    incrementMock.mockClear();
    const callbackMod = await import('../../../packages/brain/src/callback-processor.js');
    const dbMod = (await import('../../../packages/brain/src/db.js')).default as any;
    // 模拟 DB 中 task 已是 completed 状态（重放场景）
    dbMod.query.mockResolvedValue({
      rows: [{ id: 't-replay', status: 'completed', kr_id: 'kr-z' }],
      rowCount: 1,
    });

    await callbackMod.processExecutionCallback(
      {
        task_id: 't-replay',
        status: 'completed',
        pr_url: 'https://github.com/x/y/pull/999',
      },
      dbMod,
    ).catch(() => {});
    expect(incrementMock).not.toHaveBeenCalled();
  });
});
