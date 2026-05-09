import { describe, it, expect } from 'vitest';

// Generator 实现路径：sprints/w8-langgraph-v10/lib/inject-initiative.cjs
// 当前未实现 → import 阶段即失败 → Red 证据
// @ts-ignore — Red 阶段模块不存在
import { injectInitiative } from '../../lib/inject-initiative.cjs';

describe('Workstream 1 — inject-initiative [BEHAVIOR]', () => {
  it('injectInitiative() 读取 fixture payload 并通过 pgClient.query 插入一条 brain_tasks 行，返回新 id', async () => {
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

  it('当 fixture payload 缺 requirement 字段时抛 ValidationError', async () => {
    const fakePg = { query: async () => ({ rows: [] }) };
    await expect(
      injectInitiative({
        pgClient: fakePg,
        payloadPath: 'sprints/w8-langgraph-v10/fixtures/__nonexistent__.json',
      }),
    ).rejects.toThrow(/payload|requirement|not found/i);
  });
});
