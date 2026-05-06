/**
 * Workstream 4 — F4 前端可见（LiveMonitor 事件推送）BEHAVIOR 测试
 *
 * 目标函数: publishTaskDispatched(task)
 * 实现位置: packages/brain/src/events/taskEvents.js
 * WS_EVENTS.TASK_DISPATCHED 必须存在于 packages/brain/src/websocket.js
 *
 * 红阶段：publishTaskDispatched 未导出 / TASK_DISPATCHED 未定义 → 全红
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const broadcastMock = vi.fn();
vi.mock('../../../packages/brain/src/websocket.js', () => ({
  broadcast: broadcastMock,
  WS_EVENTS: {
    TASK_CREATED: 'task:created',
    TASK_STARTED: 'task:started',
    TASK_PROGRESS: 'task:progress',
    TASK_COMPLETED: 'task:completed',
    TASK_FAILED: 'task:failed',
    TASK_DISPATCHED: 'task:dispatched',
  },
}));

describe('Workstream 4 — taskEvents publishTaskDispatched [BEHAVIOR]', () => {
  let taskEvents: any;
  let websocket: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    broadcastMock.mockReset();
    taskEvents = await import('../../../packages/brain/src/events/taskEvents.js');
    // 直接 import 真实 websocket.js 校验 WS_EVENTS（不走 mock）
    vi.doUnmock('../../../packages/brain/src/websocket.js');
  });

  it('exports publishTaskDispatched from events/taskEvents.js', () => {
    expect(taskEvents.publishTaskDispatched).toBeDefined();
    expect(typeof taskEvents.publishTaskDispatched).toBe('function');
  });

  it('publishTaskDispatched(task) 调用 broadcast 一次，event 类型为 TASK_DISPATCHED', () => {
    taskEvents.publishTaskDispatched({
      id: 'task-1',
      run_id: 'run-1',
      title: 'demo',
    });
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    const [eventType] = broadcastMock.mock.calls[0];
    expect(eventType).toBe('task:dispatched');
  });

  it('publishTaskDispatched payload 包含 taskId / runId / status，status==="dispatched"', () => {
    taskEvents.publishTaskDispatched({
      id: 'task-2',
      run_id: 'run-2',
    });
    const [, payload] = broadcastMock.mock.calls[0];
    expect(payload).toBeDefined();
    expect(payload.taskId).toBe('task-2');
    expect(payload.runId).toBe('run-2');
    expect(payload.status).toBe('dispatched');
  });

  it('publishTaskDispatched 调用是同步的（不延迟到 microtask 之外）', () => {
    let called = false;
    broadcastMock.mockImplementation(() => {
      called = true;
    });
    taskEvents.publishTaskDispatched({ id: 'task-5', run_id: 'run-5' });
    // 同步调用应当在函数返回时已经触发 broadcast
    expect(called).toBe(true);
  });
});

describe('Workstream 4 — websocket.WS_EVENTS.TASK_DISPATCHED [ARTIFACT-as-BEHAVIOR]', () => {
  it('WS_EVENTS.TASK_DISPATCHED 在 websocket.js 中已声明', async () => {
    vi.resetModules();
    vi.doUnmock('../../../packages/brain/src/websocket.js');
    const ws: any = await import('../../../packages/brain/src/websocket.js');
    expect(ws.WS_EVENTS).toBeDefined();
    expect(ws.WS_EVENTS.TASK_DISPATCHED).toBeDefined();
    expect(typeof ws.WS_EVENTS.TASK_DISPATCHED).toBe('string');
    expect(ws.WS_EVENTS.TASK_DISPATCHED.length).toBeGreaterThan(0);
  });
});
