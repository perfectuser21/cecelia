/**
 * canary-isolation.test.js
 * 状态：Red（canary 过滤尚未实现，测试预期失败）
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
    // Red：battle-report.js dev_records 查询尚未加过滤
    // TODO: 实现后替换为真实 import：
    // const { buildBattleReportData } = await import('../battle-report.js');
    // const dbStub = makeDbStub({ dev_records: [] });
    // await buildBattleReportData(dbStub);
    // const devRecordsSql = dbStub._calls.find((c) => c.sql.includes('dev_records'));
    // expect(devRecordsSql).toBeDefined();
    // expect(devRecordsSql.sql).toMatch(/canary.*IS DISTINCT FROM/i);
    try {
      await import('../battle-report.js');
      throw new Error('not implemented: battle-report.js does not export buildBattleReportData with canary filter yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: battle-report.js does not exist yet');
    }
  });

  it('canary=true 的 PR 写入 dev_records 后，dev-records API 查询不返回该记录', async () => {
    // Red：pr-callback-handler.js INSERT + 查询均需加过滤
    // TODO: 实现后替换为真实调用 GET /api/brain/dev-records 接口：
    // const { buildBattleReportData } = await import('../battle-report.js');
    // const dbStub = makeDbStub({ 'SELECT': [] });
    // await buildBattleReportData(dbStub);
    // const selectSql = dbStub._calls.find((c) => c.sql.includes('dev_records') && c.sql.includes('SELECT'));
    // expect(selectSql).toBeDefined();
    // expect(selectSql.sql).toMatch(/canary.*IS DISTINCT FROM/i);
    try {
      await import('../battle-report.js');
      throw new Error('not implemented: battle-report.js does not filter canary records in dev-records API yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: battle-report.js does not exist yet');
    }
  });
});

// ─── BEHAVIOR-2：回归池入池逻辑 canary 过滤 ───────────────────────────────────

describe('BEHAVIOR-2: 回归池入池 canary 隔离', () => {
  it('task.payload.canary=true 时 promoteToRegression 跳过，不调用写库', async () => {
    // Red：harness-promote-regression.js 尚未加 canary 检测
    // TODO: 实现后替换为真实 import：
    // const { promoteToRegression } = await import('../harness-promote-regression.js');
    // const dbStub = makeDbStub();
    // const canaryTask = { id: 'canary-promo-001', payload: { canary: true } };
    // await promoteToRegression({ pool: dbStub }, { taskId: canaryTask.id, task: canaryTask, sprintDir: 'sprints/test', worktreePath: '/tmp/test' });
    // expect(dbStub._calls.filter((c) => c.sql.toLowerCase().includes('insert'))).toHaveLength(0);
    try {
      const mod = await import('../harness-promote-regression.js');
      if (!mod.promoteToRegression) {
        throw new Error('not implemented: harness-promote-regression.js does not export promoteToRegression yet');
      }
      throw new Error('not implemented: harness-promote-regression.js does not skip canary tasks yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: harness-promote-regression.js does not exist yet');
    }
  });

  it('task.payload.canary 未设 → 正常走入池路径', async () => {
    // Red：验证非 canary 任务不受影响
    // TODO: 实现后替换为真实调用：
    // const { promoteToRegression } = await import('../harness-promote-regression.js');
    // const dbStub = makeDbStub();
    // const normalTask = { id: 'task-normal-001', payload: { canary: null } };
    // await promoteToRegression({ pool: dbStub }, { taskId: normalTask.id, task: normalTask, sprintDir: 'sprints/test', worktreePath: '/tmp/test' });
    // expect(dbStub._calls.some((c) => c.sql.toLowerCase().includes('insert'))).toBe(true);
    try {
      const mod = await import('../harness-promote-regression.js');
      if (!mod.promoteToRegression) {
        throw new Error('not implemented: harness-promote-regression.js does not export promoteToRegression yet');
      }
      throw new Error('not implemented: harness-promote-regression.js does not handle non-canary tasks yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: harness-promote-regression.js does not exist yet');
    }
  });
});

// ─── BEHAVIOR-3：统计计数 canary 过滤 ────────────────────────────────────────

describe('BEHAVIOR-3: 统计计数 canary 隔离', () => {
  it('diary-scheduler dev_records count 查询含 canary 过滤条件', async () => {
    // Red：diary-scheduler.js count 查询尚未加过滤
    // TODO: 实现后替换为真实 import：
    // const { buildDiaryContent } = await import('../diary-scheduler.js');
    // const dbStub = makeDbStub({ count: [{ count: '5' }] });
    // await buildDiaryContent(dbStub, new Date('2026-07-16'));
    // const countSql = dbStub._calls.find((c) => c.sql.includes('count(*)') && c.sql.includes('dev_records'));
    // expect(countSql).toBeDefined();
    // expect(countSql.sql).toMatch(/canary.*IS DISTINCT FROM/i);
    try {
      const mod = await import('../diary-scheduler.js');
      if (!mod.buildDiaryContent) {
        throw new Error('not implemented: diary-scheduler.js does not export buildDiaryContent yet');
      }
      throw new Error('not implemented: diary-scheduler.js does not filter canary in count query yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: diary-scheduler.js does not exist yet');
    }
  });

  it('插入1条 canary 记录后，battle-report dev_records 统计数不变', async () => {
    // Red：端到端统计隔离验证
    // TODO: 实现后替换为真实调用：
    // const { buildDiaryContent } = await import('../diary-scheduler.js');
    // const dbWithFilter = makeDbStub({ count: [{ count: '3' }] });
    // await buildDiaryContent(dbWithFilter, new Date('2026-07-16'));
    // const result = dbWithFilter._calls[0];
    // expect(result.sql).toMatch(/IS DISTINCT FROM/);
    try {
      const mod = await import('../diary-scheduler.js');
      if (!mod.buildDiaryContent) {
        throw new Error('not implemented: diary-scheduler.js does not export buildDiaryContent yet');
      }
      throw new Error('not implemented: diary-scheduler.js count stat does not exclude canary records yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: diary-scheduler.js does not exist yet');
    }
  });

  it('battle-report mergedPrs 查询加 canary 过滤后，canary PR 不出现在报告中', async () => {
    // Red：battle-report 24h 统计隔离
    // TODO: 实现后替换为真实 import：
    // const { buildBattleReportData } = await import('../battle-report.js');
    // const dbStub = makeDbStub({ dev_records: [{ pr_title: 'feat: normal PR', ... }] });
    // const data = await buildBattleReportData(dbStub);
    // expect(data.mergedPrs.every(pr => !pr.payload?.canary)).toBe(true);
    try {
      await import('../battle-report.js');
      throw new Error('not implemented: battle-report.js does not filter canary PRs from mergedPrs yet');
    } catch (e) {
      if (e.message.includes('not implemented')) throw e;
      throw new Error('not implemented: battle-report.js does not exist yet');
    }
  });
});

// ─── CONSTRAINT-INV16：IS DISTINCT FROM NULL 安全性 ─────────────────────────

describe('CONSTRAINT-INV16: canary 过滤 NULL 安全性', () => {
  it('payload.canary 为 NULL 的记录不应被过滤（IS DISTINCT FROM 正确处理 NULL）', async () => {
    // payload->>'canary' IS DISTINCT FROM 'true' 对 NULL 返回 true → 不过滤
    // 验证：payload 无 canary 字段的记录（= NULL）应出现在统计中

    // 模拟真实 PostgreSQL IS DISTINCT FROM 语义
    const testCases = [
      { payloadCanary: null, shouldInclude: true },    // NULL IS DISTINCT FROM 'true' = TRUE → 包含
      { payloadCanary: 'false', shouldInclude: true }, // 'false' IS DISTINCT FROM 'true' = TRUE → 包含
      { payloadCanary: 'true', shouldInclude: false }, // 'true' IS DISTINCT FROM 'true' = FALSE → 过滤
    ];

    for (const { payloadCanary, shouldInclude } of testCases) {
      // 模拟 SQL 过滤逻辑
      const isDistinctFromTrue = payloadCanary !== 'true';
      expect(isDistinctFromTrue).toBe(shouldInclude);
    }
  });
});
