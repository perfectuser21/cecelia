/**
 * orchestrator-chat 记忆系统统一测试
 *
 * 验证 fetchMemoryContext 改用 buildMemoryContext（memory-retriever.js）
 * 而不是旧的 HTTP API（memory-service.js）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('orchestrator-chat memory unification (D1)', () => {
  let handleChat;
  let fetchMemoryContext;
  let mockBuildMemoryContext;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();

    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockBuildMemoryContext = vi.fn().mockResolvedValue({ block: '', meta: {} });

    vi.doMock('../db.js', () => ({ default: mockPool }));

    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: mockBuildMemoryContext,
    }));

    vi.doMock('../thalamus.js', () => ({
      processEvent: vi.fn(),
      EVENT_TYPES: {
        USER_MESSAGE: 'USER_MESSAGE',
        TASK_COMPLETED: 'TASK_COMPLETED',
        TASK_FAILED: 'TASK_FAILED',
        TICK: 'TICK',
        HEARTBEAT: 'HEARTBEAT',
      },
    }));

    vi.doMock('../intent.js', () => ({
      parseIntent: vi.fn().mockReturnValue({ type: 'QUESTION', confidence: 0.8 }),
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-key' })),
    }));

    // mock user-profile.js — 阻止 extractAndSaveUserFacts 触发额外 fetch 调用
    vi.doMock('../user-profile.js', () => ({
      extractAndSaveUserFacts: vi.fn().mockResolvedValue(undefined),
    }));

    const mod = await import('../orchestrator-chat.js');
    handleChat = mod.handleChat;
    fetchMemoryContext = mod.fetchMemoryContext;

    // Mock global fetch for MiniMax calls
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchMemoryContext calls buildMemoryContext with mode=chat', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '## 当前 OKR 焦点\n- 任务管理 (in_progress, 50%)\n\n## 相关历史上下文\n- [任务] **测试任务**: 任务描述',
      meta: { candidates: 5, injected: 1, tokenUsed: 100, tokenBudget: 600 },
    });

    const block = await fetchMemoryContext('任务管理');

    expect(mockBuildMemoryContext).toHaveBeenCalledWith({
      query: '任务管理',
      mode: 'chat',
      tokenBudget: 600,
      pool: mockPool,
    });
    expect(block).toContain('相关历史上下文');
    expect(block).toContain('测试任务');
  });

  it('fetchMemoryContext returns empty string for empty query', async () => {
    const block = await fetchMemoryContext('');
    expect(block).toBe('');
    expect(mockBuildMemoryContext).not.toHaveBeenCalled();
  });

  it('fetchMemoryContext returns empty string on error (graceful)', async () => {
    mockBuildMemoryContext.mockRejectedValueOnce(new Error('DB connection failed'));

    const block = await fetchMemoryContext('测试');
    expect(block).toBe('');
  });

  it('handleChat injects memory block into MiniMax prompt', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '\n## 相关历史上下文\n- [任务] **历史任务**: 相关上下文\n',
      meta: { candidates: 1, injected: 1, tokenUsed: 50 },
    });

    // Mock MiniMax call
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '好的，我了解了。' } }],
        usage: {},
      }),
    });

    const result = await handleChat('告诉我关于任务系统');

    expect(result.reply).toBe('好的，我了解了。');
    expect(result.routing_level).toBe(0);

    // 验证 MiniMax 调用中的 system prompt 包含记忆
    const minimaxCall = global.fetch.mock.calls[0];
    const body = JSON.parse(minimaxCall[1].body);
    const systemMsg = body.messages.find(m => m.role === 'system');
    expect(systemMsg.content).toContain('相关历史上下文');
    expect(systemMsg.content).toContain('历史任务');
  });

  it('handleChat works when memory returns empty block', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '',
      meta: { candidates: 0, injected: 0, tokenUsed: 0 },
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '你好！' } }],
        usage: {},
      }),
    });

    const result = await handleChat('你好');

    expect(result.reply).toBe('你好！');
    expect(result.routing_level).toBe(0);
  });

  it('does NOT call old memory-service HTTP API', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({ block: '', meta: {} });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '测试' } }],
        usage: {},
      }),
    });

    await handleChat('测试');

    // global.fetch should only be called once (MiniMax), not twice (old API + MiniMax)
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // And the call should be to MiniMax, not memory/search
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('minimaxi.com');
    expect(url).not.toContain('memory/search');
  });
});
