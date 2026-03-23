/**
 * p2p-query-dispatch.test.js
 *
 * 测试 P2P 对话查询能力：
 * - sendFeishuToOpenId 在 openId 为空时优雅降级返回 false（不抛异常）
 * - thalamus.observeChat 处理 dispatch_query_task 信号，创建含 p2p_callback 的任务
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock db.js 供 thalamus 使用 ──────────────────────────────────────────
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));

// ─── Mock generate-embedding（thalamus 依赖）─────────────────────────────
vi.mock('../generate-embedding.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
  generateEmbedding: vi.fn(),
}));

// ─── Mock llm-client（thalamus 依赖）──────────────────────────────────────
vi.mock('../llm-client.js', () => ({
  callLLM: vi.fn(),
  default: vi.fn(),
}));

// ─── Mock actions.js ─────────────────────────────────────────────────────
vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

// ─── Tests ────────────────────────────────────────────────────────────────

describe('sendFeishuToOpenId — 空 openId 优雅降级', () => {
  it('sendFeishuToOpenId 函数导出存在', async () => {
    const notifier = await import('../notifier.js');
    expect(typeof notifier.sendFeishuToOpenId).toBe('function');
  });

  it('openId 为空字符串时返回 false，不抛异常', async () => {
    const { sendFeishuToOpenId } = await import('../notifier.js');
    const result = await sendFeishuToOpenId('test message', '');
    expect(result).toBe(false);
  });

  it('openId 为 null 时返回 false，不抛异常', async () => {
    const { sendFeishuToOpenId } = await import('../notifier.js');
    const result = await sendFeishuToOpenId('test message', null);
    expect(result).toBe(false);
  });
});

describe('thalamus.observeChat — dispatch_query_task 信号', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [{ id: 'test-task-id' }] });
  });

  it('dispatch_query_task 创建 research 类型任务，payload 含 p2p_callback', async () => {
    const { observeChat } = await import('../thalamus.js');

    const signal = {
      type: 'dispatch_query_task',
      title: '查询 zenithjoy 状态',
      description: '用户询问 zenithjoy 当前状态',
    };
    const context = {
      conversation_id: 'ou_test123',
      sender_name: '测试用户',
      user_message: 'zenithjoy dashboard 现在有什么',
    };

    await observeChat(signal, context);

    const insertCall = mockPool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();

    const payload = JSON.parse(insertCall[1][3]);
    expect(payload.p2p_callback).toBeDefined();
    expect(payload.p2p_callback.open_id).toBe('ou_test123');
  });

  it('dispatch_query_task 无 conversation_id 时 p2p_callback 为 null', async () => {
    const { observeChat } = await import('../thalamus.js');

    await observeChat({ type: 'dispatch_query_task', title: '无回调查询' }, {});

    const insertCall = mockPool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const payload = JSON.parse(insertCall[1][3]);
    expect(payload.p2p_callback).toBeNull();
  });
});
