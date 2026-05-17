/**
 * taskEvents.test.js — 单元测试 emitGraphNodeUpdate。
 *
 * 配套 lint-test-pairing 要求：packages/brain/src/events/taskEvents.js 必须
 * 有同目录或 __tests__/ 下 .test.js。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({
  default: { query: mockPoolQuery },
}));

vi.mock('../../websocket.js', () => ({
  broadcast: vi.fn(),
  WS_EVENTS: {},
}));

let emitGraphNodeUpdate;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  const mod = await import('../taskEvents.js');
  emitGraphNodeUpdate = mod.emitGraphNodeUpdate;
});

describe('emitGraphNodeUpdate — taskEvents 单元 smoke', () => {
  it('export 存在并是函数', () => {
    expect(typeof emitGraphNodeUpdate).toBe('function');
  });

  it('调用一次 → INSERT INTO task_events 一条 graph_node_update 行', async () => {
    await emitGraphNodeUpdate({
      taskId: 'task-1',
      initiativeId: 'init-1',
      threadId: 'harness-initiative:init-1:1',
      nodeName: 'planner',
      attemptN: 1,
      payloadSummary: { foo: 'bar' },
    });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT\s+INTO\s+task_events/i);
    expect(sql).toMatch(/graph_node_update/);
    expect(params[0]).toBe('task-1');
    const payload = JSON.parse(params[1]);
    expect(payload.nodeName).toBe('planner');
    expect(payload.attemptN).toBe(1);
    expect(payload.threadId).toContain('init-1');
  });

  it('opts.pool 注入 → 不调主 pool', async () => {
    const altQuery = vi.fn().mockResolvedValue({ rows: [] });
    await emitGraphNodeUpdate({
      taskId: 't',
      initiativeId: 'i',
      threadId: 'thr',
      nodeName: 'node',
      attemptN: 1,
      payloadSummary: {},
      pool: { query: altQuery },
    });
    expect(altQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
