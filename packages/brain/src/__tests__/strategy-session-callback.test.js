/**
 * strategy-session-callback 单元测试
 *
 * 覆盖 DoD：
 *   D1/D2 - 正常路径：strategy_session completed → 3 条 KR 写入 goals
 *   D3    - meeting_summary 写入任务 summary 字段
 *   D4    - JSON 解析失败：不写入 goals，函数正常返回
 *   D5    - krs 为空：跳过写入
 *   D6    - 单条 KR INSERT 失败：继续写入剩余 KR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStrategySessionCompletion } from '../strategy-session-callback.js';

function makePool(taskRow, queryImpl) {
  const pool = {
    query: queryImpl || vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
  if (taskRow !== undefined && !queryImpl) {
    pool.query = vi.fn().mockImplementation(async (sql) => {
      if (sql.includes('SELECT task_type, project_id FROM tasks')) {
        return { rows: taskRow ? [taskRow] : [] };
      }
      return { rows: [], rowCount: 0 };
    });
  }
  return pool;
}

const STRATEGY_TASK = { task_type: 'strategy_session', project_id: 'proj-abc' };

const VALID_OUTPUT = {
  meeting_summary: '季度战略会议摘要',
  key_tensions: ['效率 vs 质量', '速度 vs 稳定'],
  krs: [
    { title: 'KR1：提升研发效率', domain: 'tech', owner_role: 'CTO', priority: 'P0' },
    { title: 'KR2：增长 DAU 20%', domain: 'growth', owner_role: 'CMO', priority: 'P1' },
    { title: 'KR3：降低成本 15%', domain: 'finance', owner_role: 'CFO', priority: 'P1' },
  ],
};

describe('handleStrategySessionCompletion', () => {
  it('D1/D2/D3 - 正常路径：写入 3 条 KR + summary', async () => {
    const calls = [];
    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [STRATEGY_TASK] };
      }),
    };

    const result = await handleStrategySessionCompletion(pool, 'task-1', VALID_OUTPUT);

    expect(result.krs_inserted).toBe(3);
    expect(result.summary_written).toBe(true);

    // D3: summary UPDATE 被调用
    const summaryCall = calls.find(c => c.sql.includes('UPDATE tasks SET summary'));
    expect(summaryCall).toBeTruthy();
    expect(summaryCall.params[0]).toContain('季度战略会议摘要');
    expect(summaryCall.params[0]).toContain('效率 vs 质量');
    expect(summaryCall.params[1]).toBe('task-1');

    // D1/D2: goals INSERT 被调用 3 次，含正确字段
    const insertCalls = calls.filter(c => c.sql.includes('INSERT INTO goals'));
    expect(insertCalls).toHaveLength(3);

    const kr1 = insertCalls[0].params;
    expect(kr1[0]).toBe('KR1：提升研发效率');
    expect(kr1[1]).toBe('tech');
    expect(kr1[2]).toBe('CTO');
    expect(kr1[3]).toBe('P0');
    expect(kr1[4]).toBe('proj-abc');

    // D2: SQL 包含 status='pending'
    expect(insertCalls[0].sql).toContain("'pending'");
  });

  it('D4 - JSON 字符串解析失败：不写入 goals，正常返回', async () => {
    const pool = makePool(STRATEGY_TASK);

    const result = await handleStrategySessionCompletion(pool, 'task-2', 'not valid json {{');

    expect(result.krs_inserted).toBe(0);
    expect(result.summary_written).toBe(false);

    // goals INSERT 不被调用
    const insertCalls = pool.query.mock.calls.filter(c => c[0].includes('INSERT INTO goals'));
    expect(insertCalls).toHaveLength(0);
  });

  it('D4 - result 为非 JSON 对象（无 krs 字段）：不写入 goals', async () => {
    const pool = makePool(STRATEGY_TASK);

    // result is a plain object but without krs
    const result = await handleStrategySessionCompletion(pool, 'task-3', { some: 'data' });

    expect(result.krs_inserted).toBe(0);
    const insertCalls = pool.query.mock.calls.filter(c => c[0].includes('INSERT INTO goals'));
    expect(insertCalls).toHaveLength(0);
  });

  it('D5 - krs 为空数组：跳过写入', async () => {
    const pool = makePool(STRATEGY_TASK);
    const output = { meeting_summary: '摘要', key_tensions: [], krs: [] };

    const result = await handleStrategySessionCompletion(pool, 'task-4', output);

    expect(result.krs_inserted).toBe(0);
    const insertCalls = pool.query.mock.calls.filter(c => c[0].includes('INSERT INTO goals'));
    expect(insertCalls).toHaveLength(0);
  });

  it('D6 - 第一条 KR INSERT 失败：继续写入第二条', async () => {
    let insertCount = 0;
    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('SELECT task_type, project_id FROM tasks')) {
          return { rows: [STRATEGY_TASK] };
        }
        if (sql.includes('INSERT INTO goals')) {
          insertCount++;
          if (insertCount === 1) throw new Error('DB connection error');
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const output = {
      meeting_summary: '摘要',
      krs: [
        { title: 'KR-失败', domain: 'tech', owner_role: 'CTO', priority: 'P0' },
        { title: 'KR-成功', domain: 'growth', owner_role: 'CMO', priority: 'P1' },
      ],
    };

    const result = await handleStrategySessionCompletion(pool, 'task-5', output);

    // 第一条失败，第二条仍被写入
    expect(result.krs_inserted).toBe(1);
    expect(insertCount).toBe(2);
  });

  it('非 strategy_session 任务：直接返回，不做任何写入', async () => {
    const pool = makePool({ task_type: 'dev', project_id: null });

    const result = await handleStrategySessionCompletion(pool, 'task-6', VALID_OUTPUT);

    expect(result.krs_inserted).toBe(0);
    expect(result.summary_written).toBe(false);

    // 只有 SELECT 被调用，没有 INSERT/UPDATE
    const writeCalls = pool.query.mock.calls.filter(c =>
      c[0].includes('INSERT') || c[0].includes('UPDATE tasks SET summary')
    );
    expect(writeCalls).toHaveLength(0);
  });

  it('result 为字符串形式的 JSON：正确解析并写入', async () => {
    const calls = [];
    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [STRATEGY_TASK] };
      }),
    };

    const jsonString = JSON.stringify({
      meeting_summary: '字符串 JSON 输出',
      krs: [{ title: 'KR-string', domain: 'tech', owner_role: 'CTO', priority: 'P1' }],
    });

    const result = await handleStrategySessionCompletion(pool, 'task-7', jsonString);

    expect(result.krs_inserted).toBe(1);
    expect(result.summary_written).toBe(true);
  });

  it('result.result 为字符串（Skill 输出格式）：正确解析', async () => {
    const calls = [];
    const pool = {
      query: vi.fn().mockImplementation(async (sql) => {
        calls.push(sql);
        return { rows: [STRATEGY_TASK] };
      }),
    };

    const wrappedResult = {
      result: JSON.stringify({
        meeting_summary: '封装格式',
        krs: [{ title: 'KR-wrapped', domain: 'ops', owner_role: 'COO', priority: 'P2' }],
      }),
    };

    const result = await handleStrategySessionCompletion(pool, 'task-8', wrappedResult);

    expect(result.krs_inserted).toBe(1);
  });
});
