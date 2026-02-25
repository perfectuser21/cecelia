/**
 * Orchestrator Realtime Tests
 *
 * 测试覆盖：
 * - D2: getRealtimeConfig 返回正确配置
 * - D3: handleRealtimeTool 处理工具调用
 * - D4: handleRealtimeWebSocket 基本验证
 * - D5: routes 注册验证
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Tests: getRealtimeConfig (D2)
// ============================================================

describe('getRealtimeConfig (D2)', () => {
  let getRealtimeConfig;
  let _resetApiKey;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../db.js', () => ({
      default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn((path) => {
        if (path.includes('openai.env')) {
          return 'OPENAI_API_KEY=sk-test-key-12345';
        }
        throw new Error('File not found');
      }),
    }));

    // Mock ws module
    vi.doMock('ws', () => ({
      default: vi.fn(),
    }));

    const mod = await import('../orchestrator-realtime.js');
    getRealtimeConfig = mod.getRealtimeConfig;
    _resetApiKey = mod._resetApiKey;
  });

  afterEach(() => {
    _resetApiKey();
  });

  it('returns config with api_key, model, voice, instructions, tools', () => {
    const result = getRealtimeConfig();

    expect(result.success).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config.api_key).toBe('sk-test-key-12345');
    expect(result.config.model).toContain('realtime');
    expect(result.config.voice).toBe('sage');
    expect(result.config.instructions).toBeTruthy();
    expect(result.config.tools).toBeInstanceOf(Array);
    expect(result.config.tools.length).toBeGreaterThan(0);
    expect(result.config.url).toContain('wss://api.openai.com');
  });

  it('returns error when API key not configured', async () => {
    _resetApiKey();
    vi.resetModules();

    vi.doMock('../db.js', () => ({
      default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => { throw new Error('No such file'); }),
    }));

    vi.doMock('ws', () => ({
      default: vi.fn(),
    }));

    const mod = await import('../orchestrator-realtime.js');
    const result = mod.getRealtimeConfig();

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('tools include query_system_status, query_tasks, navigate_to_page', () => {
    const result = getRealtimeConfig();
    const toolNames = result.config.tools.map(t => t.name);

    expect(toolNames).toContain('query_system_status');
    expect(toolNames).toContain('query_tasks');
    expect(toolNames).toContain('navigate_to_page');
  });
});

// ============================================================
// Tests: handleRealtimeTool (D3)
// ============================================================

describe('handleRealtimeTool (D3)', () => {
  let handleRealtimeTool;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();

    mockPool = { query: vi.fn() };

    vi.doMock('../db.js', () => ({
      default: mockPool,
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => 'OPENAI_API_KEY=sk-test-key'),
    }));

    vi.doMock('ws', () => ({
      default: vi.fn(),
    }));

    const mod = await import('../orchestrator-realtime.js');
    handleRealtimeTool = mod.handleRealtimeTool;
  });

  it('query_system_status returns task and goal stats', async () => {
    const mockDbPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ status: 'completed', cnt: 10 }, { status: 'in_progress', cnt: 3 }] })
        .mockResolvedValueOnce({ rows: [{ status: 'active', cnt: 2 }] }),
    };

    const result = await handleRealtimeTool('query_system_status', {}, mockDbPool);

    expect(result.success).toBe(true);
    expect(result.result.tasks.completed).toBe(10);
    expect(result.result.tasks.in_progress).toBe(3);
    expect(result.result.goals.active).toBe(2);
  });

  it('query_tasks returns task list with optional status filter', async () => {
    const mockDbPool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { id: '1', title: 'Task A', status: 'in_progress', priority: 'P0', updated_at: '2026-02-22' },
          { id: '2', title: 'Task B', status: 'in_progress', priority: 'P1', updated_at: '2026-02-21' },
        ],
      }),
    };

    const result = await handleRealtimeTool('query_tasks', { status: 'in_progress', limit: 2 }, mockDbPool);

    expect(result.success).toBe(true);
    expect(result.result.tasks).toHaveLength(2);
    expect(result.result.tasks[0].title).toBe('Task A');

    // 验证 SQL 包含 WHERE 子句
    const [sql, params] = mockDbPool.query.mock.calls[0];
    expect(sql).toContain('WHERE status = $1');
    expect(params[0]).toBe('in_progress');
    expect(params[1]).toBe(2);
  });

  it('query_tasks works without status filter', async () => {
    const mockDbPool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{ id: '1', title: 'All tasks', status: 'queued', priority: 'P2', updated_at: '2026-02-22' }],
      }),
    };

    const result = await handleRealtimeTool('query_tasks', {}, mockDbPool);

    expect(result.success).toBe(true);
    const [sql, params] = mockDbPool.query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([5]); // default limit
  });

  it('navigate_to_page returns navigated_to result', async () => {
    const result = await handleRealtimeTool('navigate_to_page', { page: 'okr' }, mockPool);

    expect(result.success).toBe(true);
    expect(result.result.navigated_to).toBe('okr');
  });

  it('returns error for unknown tool', async () => {
    const result = await handleRealtimeTool('unknown_tool', {}, mockPool);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('handles DB error gracefully', async () => {
    const mockDbPool = {
      query: vi.fn().mockRejectedValueOnce(new Error('DB connection lost')),
    };

    const result = await handleRealtimeTool('query_system_status', {}, mockDbPool);

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB connection lost');
  });
});

// ============================================================
// Tests: handleRealtimeWebSocket (D4)
// ============================================================

describe('handleRealtimeWebSocket (D4)', () => {
  let handleRealtimeWebSocket;
  let _resetApiKey;
  let MockWebSocket;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../db.js', () => ({
      default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => 'OPENAI_API_KEY=sk-test-key'),
    }));

    // Mock WebSocket constructor
    MockWebSocket = vi.fn().mockImplementation(() => {
      const listeners = {};
      return {
        readyState: 1, // WebSocket.OPEN
        on: vi.fn((event, cb) => { listeners[event] = cb; }),
        send: vi.fn(),
        close: vi.fn(),
        _listeners: listeners,
        OPEN: 1,
      };
    });
    MockWebSocket.OPEN = 1;

    vi.doMock('ws', () => ({
      default: MockWebSocket,
    }));

    const mod = await import('../orchestrator-realtime.js');
    handleRealtimeWebSocket = mod.handleRealtimeWebSocket;
    _resetApiKey = mod._resetApiKey;
  });

  afterEach(() => {
    _resetApiKey();
  });

  it('closes client if API key not configured', async () => {
    _resetApiKey();
    vi.resetModules();

    vi.doMock('../db.js', () => ({
      default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => { throw new Error('No file'); }),
    }));

    vi.doMock('ws', () => ({
      default: vi.fn(),
    }));

    const mod = await import('../orchestrator-realtime.js');
    const clientWs = { close: vi.fn(), on: vi.fn() };

    mod.handleRealtimeWebSocket(clientWs, {});

    expect(clientWs.close).toHaveBeenCalledWith(1008, expect.stringContaining('not configured'));
  });

  it('creates OpenAI WebSocket with correct headers', () => {
    const clientWs = {
      readyState: 1,
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };

    handleRealtimeWebSocket(clientWs, {});

    expect(MockWebSocket).toHaveBeenCalledWith(
      expect.stringContaining('api.openai.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-test-key',
          'OpenAI-Beta': 'realtime=v1',
        }),
      })
    );
  });

  it('registers message/error/close handlers on both connections', () => {
    const clientWs = {
      readyState: 1,
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };

    handleRealtimeWebSocket(clientWs, {});

    // Client handlers
    const clientEvents = clientWs.on.mock.calls.map(c => c[0]);
    expect(clientEvents).toContain('message');
    expect(clientEvents).toContain('error');
    expect(clientEvents).toContain('close');

    // OpenAI handlers
    const openaiInstance = MockWebSocket.mock.results[0].value;
    const openaiEvents = openaiInstance.on.mock.calls.map(c => c[0]);
    expect(openaiEvents).toContain('open');
    expect(openaiEvents).toContain('message');
    expect(openaiEvents).toContain('error');
    expect(openaiEvents).toContain('close');
  });
});

// ============================================================
// Tests: Routes registration (D5)
// ============================================================

describe('Realtime routes registration (D5)', () => {
  it('getRealtimeConfig is exported and callable', async () => {
    vi.resetModules();

    vi.doMock('../db.js', () => ({
      default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));
    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => 'OPENAI_API_KEY=sk-test'),
    }));
    vi.doMock('ws', () => ({
      default: vi.fn(),
    }));

    const mod = await import('../orchestrator-realtime.js');
    expect(typeof mod.getRealtimeConfig).toBe('function');
    expect(typeof mod.handleRealtimeTool).toBe('function');
    expect(typeof mod.handleRealtimeWebSocket).toBe('function');
  });
});
