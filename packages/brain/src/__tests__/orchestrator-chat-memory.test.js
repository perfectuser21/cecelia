/**
 * orchestrator-chat 记忆系统统一测试
 *
 * 验证 fetchMemoryContext 改用 buildMemoryContext（memory-retriever.js）
 * 而不是旧的 HTTP API（memory-service.js）
 *
 * callMiniMax 内部调用 callLLM('mouth', ...) 而非直接调 MiniMax API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('orchestrator-chat memory unification (D1)', () => {
  let handleChat;
  let fetchMemoryContext;
  let mockBuildMemoryContext;
  let mockCallLLM;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();

    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockBuildMemoryContext = vi.fn().mockResolvedValue({ block: '', meta: {} });
    mockCallLLM = vi.fn().mockResolvedValue({ text: '', model: 'claude-haiku-4-5-20251001', provider: 'anthropic', elapsed_ms: 100 });

    vi.doMock('../db.js', () => ({ default: mockPool }));

    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: mockBuildMemoryContext,
    }));

    vi.doMock('../llm-caller.js', () => ({
      callLLM: mockCallLLM,
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

    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-minimax-key' })),
    }));

    vi.doMock('node:os', () => ({
      homedir: vi.fn().mockReturnValue('/home/testuser'),
    }));

    vi.doMock('node:path', async () => {
      const actual = await vi.importActual('node:path');
      return actual;
    });

    // mock user-profile.js
    vi.doMock('../user-profile.js', () => ({
      extractAndSaveUserFacts: vi.fn().mockResolvedValue(undefined),
      getUserProfileContext: vi.fn().mockResolvedValue(''),
    }));

    // mock chat-action-dispatcher.js
    vi.doMock('../chat-action-dispatcher.js', () => ({
      detectAndExecuteAction: vi.fn().mockResolvedValue(''),
    }));

    const mod = await import('../orchestrator-chat.js');
    handleChat = mod.handleChat;
    fetchMemoryContext = mod.fetchMemoryContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchMemoryContext calls buildMemoryContext with mode=chat', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '## 当前 OKR 焦点\n- 任务管理 (in_progress, 50%)\n\n## 相关历史上下文\n- [任务] **测试任务**: 任务描述',
      meta: { candidates: 5, injected: 1, tokenUsed: 100, tokenBudget: 1000 },
    });

    const block = await fetchMemoryContext('任务管理');

    expect(mockBuildMemoryContext).toHaveBeenCalledWith({
      query: '任务管理',
      mode: 'chat',
      tokenBudget: 1000,
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

  it('handleChat calls callLLM with mouth agent and injects memory into prompt', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '\n## 相关历史上下文\n- [任务] **历史任务**: 相关上下文\n',
      meta: { candidates: 1, injected: 1, tokenUsed: 50 },
    });

    // Mock callLLM response
    mockCallLLM.mockResolvedValueOnce({
      text: '好的，我了解了。',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      elapsed_ms: 200,
    });

    const result = await handleChat('告诉我关于任务系统');

    expect(result.reply).toBe('好的，我了解了。');
    expect(result.routing_level).toBe(0);

    // 验证 callLLM 被调用，agent 为 'mouth'，prompt 包含记忆上下文
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [agent, prompt, opts] = mockCallLLM.mock.calls[0];
    expect(agent).toBe('mouth');
    expect(prompt).toContain('相关历史上下文');
    expect(prompt).toContain('历史任务');
    expect(prompt).toContain('告诉我关于任务系统');
  });

  it('handleChat works when memory returns empty block', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({
      block: '',
      meta: { candidates: 0, injected: 0, tokenUsed: 0 },
    });

    mockCallLLM.mockResolvedValueOnce({
      text: '你好！',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      elapsed_ms: 100,
    });

    const result = await handleChat('你好');

    expect(result.reply).toBe('你好！');
    expect(result.routing_level).toBe(0);
  });

  it('does NOT call global.fetch (no direct MiniMax API calls)', async () => {
    mockBuildMemoryContext.mockResolvedValueOnce({ block: '', meta: {} });

    mockCallLLM.mockResolvedValueOnce({
      text: '测试',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      elapsed_ms: 50,
    });

    // Set up a spy on global.fetch to ensure it's NOT called
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    await handleChat('测试');

    // callLLM should be called, not global.fetch
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
