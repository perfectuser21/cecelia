/**
 * WS2 Red Tests — harness-container-monitor.js
 * 在 WS2 实现前，以下测试必须全部 FAIL（文件不存在 → import error）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 如果文件不存在，import 会直接 throw → 所有 tests FAIL（Red 证据）
let checkHarnessContainers: Function;
let createInterventionTask: Function;

describe('WS2 — harness-container-monitor 行为验证 [BEHAVIOR]', () => {
  beforeEach(async () => {
    try {
      const mod = await import('../../../../packages/brain/src/harness-container-monitor.js');
      checkHarnessContainers = mod.checkHarnessContainers;
      createInterventionTask = mod.createInterventionTask;
    } catch {
      checkHarnessContainers = undefined as any;
      createInterventionTask = undefined as any;
    }
  });

  it('导出 checkHarnessContainers 函数', () => {
    expect(typeof checkHarnessContainers).toBe('function');
  });

  it('导出 createInterventionTask 函数', () => {
    expect(typeof createInterventionTask).toBe('function');
  });

  it('createInterventionTask 创建 harness_intervention task（mock pool）', async () => {
    expect(typeof createInterventionTask).toBe('function');

    const insertedRows: any[] = [];
    const mockPool = {
      // 同时处理内联 SQL（sql 含字面量）和参数化 SQL（params 数组含 'harness_intervention'）
      query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
        const isIdempotencyCheck =
          sql.includes('SELECT') &&
          (sql.includes('harness_intervention') ||
            (Array.isArray(params) && params.includes('harness_intervention')));
        if (isIdempotencyCheck) {
          // 幂等查询：无已有记录
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO tasks')) {
          const row = { id: 'test-uuid-001', task_type: 'harness_intervention' };
          insertedRows.push(row);
          return Promise.resolve({ rows: [row] });
        }
        if (sql.includes('INSERT INTO cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const result = await createInterventionTask(mockPool, {
      initiativeId: 'test-initiative-abc',
      reason: 'container_exited',
      anomalyType: 'exited',
    });

    expect(result).toBeTruthy();
    expect(result.skipped).not.toBe(true);
    expect(insertedRows.length).toBeGreaterThanOrEqual(1);
    expect(insertedRows[0].task_type).toBe('harness_intervention');
  });

  it('createInterventionTask 幂等：已有 in_progress intervention 时返回 skipped:true', async () => {
    expect(typeof createInterventionTask).toBe('function');

    const mockPool = {
      // 同时处理内联 SQL 和参数化 SQL（params 数组含 'harness_intervention'）
      query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
        const isIdempotencyCheck =
          sql.includes('SELECT') &&
          (sql.includes('harness_intervention') ||
            (Array.isArray(params) && params.includes('harness_intervention')));
        if (isIdempotencyCheck) {
          // 已有进行中的 intervention
          return Promise.resolve({ rows: [{ id: 'existing-task', status: 'in_progress' }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const result = await createInterventionTask(mockPool, {
      initiativeId: 'test-initiative-xyz',
      reason: 'duplicate',
      anomalyType: 'exited',
    });

    expect(result).toBeTruthy();
    expect(result.skipped).toBe(true);
  });

  it('checkHarnessContainers docker 不可用时不 throw（warn 降级）— 合同签名: {pool, dockerUnavailable?: boolean}', async () => {
    expect(typeof checkHarnessContainers).toBe('function');

    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    // 合同规定：函数签名为 checkHarnessContainers(opts: {pool, dockerUnavailable?: boolean})
    // dockerUnavailable:true 注入 flag，跳过真实 docker 调用，允许纯单测环境运行
    await expect(
      checkHarnessContainers({ pool: mockPool, dockerUnavailable: true })
    ).resolves.not.toThrow();
  });
});
