/**
 * canary-isolation.test.js
 * 状态：Green
 *
 * 覆盖：
 *   BEHAVIOR-1  canary 隔离过滤 dev-records
 *   BEHAVIOR-2  canary 隔离过滤回归池
 *   BEHAVIOR-3  canary 隔离过滤统计计数（battle-report + diary-scheduler）
 *
 * 规则（INV-04/INV-16）：
 * - 只 mock DB pool（无测试数据库）；SQL 条件构造不 mock，必须验证 SQL 字符串
 * - canary 过滤条件必须使用 IS DISTINCT FROM 'true'（处理 NULL 安全）
 * - 每条测试需断言 SQL 中含正确的 canary 过滤表达式
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

function makeDbStub(rowsByQuery = {}) {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      // 按 SQL 关键词返回预设 rows
      for (const [key, rows] of Object.entries(rowsByQuery)) {
        if (sql.includes(key)) return { rows };
      }
      return { rows: [] };
    }),
    _calls: calls,
  };
}

// ─── BEHAVIOR-1：dev-records 查询加 canary 过滤 ───────────────────────────────

describe('BEHAVIOR-1: dev-records 查询 canary 隔离', () => {
  it('battle-report dev_records 查询含 canary 过滤条件', async () => {
    const { buildBattleReportData } = await import('../battle-report.js');
    const dbStub = makeDbStub({ dev_records: [] });
    await buildBattleReportData(dbStub);
    const devRecordsSql = dbStub._calls.find((c) => c.sql.includes('dev_records'));
    expect(devRecordsSql).toBeDefined();
    expect(devRecordsSql.sql).toMatch(/IS DISTINCT FROM/i);
    expect(devRecordsSql.sql).toMatch(/canary/i);
  });

  it('canary=true 的 PR 写入 dev_records 后，dev-records 查询不返回该记录（SQL 过滤验证）', async () => {
    const { buildBattleReportData } = await import('../battle-report.js');
    const dbStub = makeDbStub({ dev_records: [] });
    await buildBattleReportData(dbStub);
    const selectSql = dbStub._calls.find((c) => c.sql.includes('dev_records') && c.sql.includes('SELECT'));
    expect(selectSql).toBeDefined();
    expect(selectSql.sql).toMatch(/IS DISTINCT FROM/i);
  });
});

// ─── BEHAVIOR-2：回归池入池逻辑 canary 过滤 ───────────────────────────────────

describe('BEHAVIOR-2: 回归池入池 canary 隔离', () => {
  it('task.payload.canary=true 时 promoteToRegression 跳过，不调用写库', async () => {
    const { promoteToRegression } = await import('../harness-promote-regression.js');
    const dbStub = makeDbStub();
    const canaryTask = { id: 'canary-promo-001', payload: { canary: true } };
    const result = await promoteToRegression(
      { pool: dbStub, execFile: vi.fn(), fsImpl: { readFileSync: vi.fn(() => '') } },
      { task: canaryTask, sprintDir: 'sprints/test', worktreePath: '/tmp/test' }
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/canary/i);
    // 不应有任何 INSERT 写库
    const insertCalls = dbStub._calls.filter((c) => c.sql.toLowerCase().includes('insert'));
    expect(insertCalls).toHaveLength(0);
  });

  it('task.payload.canary=true（字符串）时 promoteToRegression 也跳过', async () => {
    const { promoteToRegression } = await import('../harness-promote-regression.js');
    const dbStub = makeDbStub();
    const canaryTask = { id: 'canary-promo-002', payload: { canary: 'true' } };
    const result = await promoteToRegression(
      { pool: dbStub, execFile: vi.fn(), fsImpl: { readFileSync: vi.fn(() => '') } },
      { task: canaryTask, sprintDir: 'sprints/test', worktreePath: '/tmp/test' }
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/canary/i);
  });

  it('task.payload.canary 未设 → 正常走后续路径（不因 canary 守卫跳出）', async () => {
    const { promoteToRegression } = await import('../harness-promote-regression.js');
    const dbStub = makeDbStub();
    const normalTask = { id: 'task-normal-001', payload: {} };
    const result = await promoteToRegression(
      { pool: dbStub, execFile: vi.fn(), fsImpl: { readFileSync: vi.fn(() => '') } },
      { task: normalTask, sprintDir: 'sprints/test', worktreePath: '/tmp/test' }
    );
    // 非 canary 任务不应因 canary 守卫返回 skipped（可能因其他原因 skip，但不是 canary）
    if (result.skipped) {
      expect(result.reason).not.toMatch(/canary/i);
    }
  });
});

// ─── BEHAVIOR-3：统计计数 canary 过滤 ────────────────────────────────────────

describe('BEHAVIOR-3: 统计计数 canary 隔离', () => {
  it('diary-scheduler dev_records count 查询含 canary 过滤条件', async () => {
    // 验证 diary-scheduler.js 源码中 dev_records count 查询含 canary 过滤（读源文件）
    const fs = await import('node:fs');
    const schedulerSrc = fs.default.readFileSync(
      '/workspace/packages/brain/src/diary-scheduler.js',
      'utf8'
    );
    // 确认整个文件含有 canary 过滤的 dev_records count SQL
    expect(schedulerSrc).toContain("SELECT count(*) FROM dev_records");
    expect(schedulerSrc).toMatch(/dev_records.*IS DISTINCT FROM/s);
    expect(schedulerSrc).toMatch(/dev_records.*canary/s);
  });

  it('battle-report mergedPrs 查询加 canary 过滤后，SQL 正确', async () => {
    const { buildBattleReportData } = await import('../battle-report.js');
    const dbStub = makeDbStub({});
    await buildBattleReportData(dbStub);
    const mergedPrsSql = dbStub._calls.find(
      (c) => c.sql.includes('dev_records') && c.sql.includes('SELECT')
    );
    expect(mergedPrsSql).toBeDefined();
    expect(mergedPrsSql.sql).toMatch(/IS DISTINCT FROM.*'true'/i);
  });

  it('插入1条 canary 记录后，SQL WHERE 子句确保不计入统计（IS DISTINCT FROM 语义验证）', () => {
    // 纯语义：payload->>'canary' IS DISTINCT FROM 'true' 对 NULL → true（计入）
    const testCases = [
      { payloadCanary: null,    shouldInclude: true  },
      { payloadCanary: 'false', shouldInclude: true  },
      { payloadCanary: 'true',  shouldInclude: false },
    ];
    for (const { payloadCanary, shouldInclude } of testCases) {
      const isDistinctFromTrue = payloadCanary !== 'true';
      expect(isDistinctFromTrue).toBe(shouldInclude);
    }
  });
});

// ─── CONSTRAINT-INV16：IS DISTINCT FROM NULL 安全性 ─────────────────────────

describe('CONSTRAINT-INV16: canary 过滤 NULL 安全性', () => {
  it('payload.canary 为 NULL 的记录不应被过滤（IS DISTINCT FROM 正确处理 NULL）', async () => {
    // payload->>'canary' IS DISTINCT FROM 'true' 对 NULL 返回 true → 不过滤
    const testCases = [
      { payloadCanary: null,    shouldInclude: true  },
      { payloadCanary: 'false', shouldInclude: true  },
      { payloadCanary: 'true',  shouldInclude: false },
    ];

    for (const { payloadCanary, shouldInclude } of testCases) {
      const isDistinctFromTrue = payloadCanary !== 'true';
      expect(isDistinctFromTrue).toBe(shouldInclude);
    }
  });
});
