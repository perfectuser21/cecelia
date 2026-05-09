import { describe, it, expect, beforeAll } from 'vitest';

// Generator 实现路径：sprints/w8-langgraph-v10/lib/inject-initiative.cjs
// 红阶段（未实现）：动态 import 失败 → 每个 it() 在断言 importError 时失败 → numFailedTests == it 数
// 绿阶段（实现后）：mod 非 null → 真实测试体跑过 → numFailedTests == 0
let mod: any = null;
let importError: Error | null = null;

beforeAll(async () => {
  try {
    // @ts-ignore — 红阶段模块不存在
    mod = await import('../../lib/inject-initiative.cjs');
  } catch (e) {
    importError = e as Error;
  }
});

describe('Workstream 1 — inject-initiative [BEHAVIOR]', () => {
  it('injectInitiative() 读取 fixture payload 并通过 pgClient.query 插入一条 brain_tasks 行，返回新 id', async () => {
    expect(importError, 'lib/inject-initiative.cjs 必须存在并可加载').toBeNull();
    const { injectInitiative } = mod;
    const calls: any[] = [];
    const fakePg = {
      query: async (sql: string, params: any[]) => {
        calls.push({ sql, params });
        return { rows: [{ id: '11111111-2222-3333-4444-555555555555' }] };
      },
    };

    const id = await injectInitiative({
      pgClient: fakePg,
      payloadPath: 'sprints/w8-langgraph-v10/fixtures/initiative-payload.json',
    });

    expect(id).toBe('11111111-2222-3333-4444-555555555555');
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toMatch(/INSERT INTO brain_tasks/i);
    expect(calls[0].sql).toMatch(/RETURNING id/i);
  });

  it('当 fixture payload 缺 requirement 字段或文件不存在时抛 ValidationError', async () => {
    expect(importError, 'lib/inject-initiative.cjs 必须存在并可加载').toBeNull();
    const { injectInitiative } = mod;
    const fakePg = { query: async () => ({ rows: [] }) };
    await expect(
      injectInitiative({
        pgClient: fakePg,
        payloadPath: 'sprints/w8-langgraph-v10/fixtures/__nonexistent__.json',
      }),
    ).rejects.toThrow(/payload|requirement|not found/i);
  });
});
