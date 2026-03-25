/**
 * thalamus SUGGESTION_READY 事件处理测试
 * 验证丘脑统一决策创建 suggestion_plan 任务（去重、速率限制、创建）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  }
}));

// Mock 所有 thalamus 依赖的外部模块
vi.mock('../learning.js', () => ({
  getRecentLearnings: vi.fn(async () => []),
  upsertLearning: vi.fn(async () => {}),
}));
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn(async () => ''),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(async () => ({ text: '' })),
}));
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));
vi.mock('../role-registry.js', () => ({
  buildDomainRouteTable: vi.fn(() => ''),
}));

import { processEvent, EVENT_TYPES } from '../thalamus.js';
import pool from '../db.js';

/**
 * 构建 mock pool，支持事务
 */
function buildMockPool({
  inFlight = [],
  queueCount = 0,
  insertedTaskId = 'task-thal-001',
} = {}) {
  const client = {
    query: vi.fn(async (sql, params) => {
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql.trim())) return { rows: [] };
      if (sql.includes('INSERT INTO tasks')) return { rows: [{ id: insertedTaskId }] };
      if (sql.includes('UPDATE suggestions')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return {
    query: vi.fn(async (sql, params) => {
      // 去重查询
      if (sql.includes('suggestion_plan') && sql.includes('in_progress')) {
        return { rows: inFlight };
      }
      // 队列负载查询
      if (sql.includes('COUNT(*)') && sql.includes('suggestion_plan')) {
        return { rows: [{ count: queueCount }] };
      }
      // cecelia_events insert（recordRoutingDecision）
      if (sql.includes('cecelia_events')) return { rows: [] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
    _client: client,
  };
}

function makeSuggestionEvent(overrides = {}) {
  return {
    type: EVENT_TYPES.SUGGESTION_READY,
    suggestion_id: 'sug-001',
    content: '建议优化任务调度性能',
    priority_score: 0.85,
    source: 'rumination',
    agent_id: null,
    task_title: '[SUGGESTION_PLAN] 层级识别：建议优化任务调度性能',
    task_description: '请识别此 Suggestion 的层级（Layer 3 KR / Layer 4 Project / Layer 5 Scope / Layer 6 Initiative / Layer 7 Task/Pipeline）',
    domain: 'agent_ops',
    owner_role: 'vp_agent_ops',
    ...overrides,
  };
}

describe('thalamus SUGGESTION_READY 处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: 正常路径 — 创建 suggestion_plan 任务，返回 _suggestion_dispatched=true', async () => {
    const mockPool = buildMockPool({ inFlight: [], queueCount: 0 });
    // 替换全局 pool
    pool.query = mockPool.query;
    pool.connect = mockPool.connect;

    const decision = await processEvent(makeSuggestionEvent());

    expect(decision._suggestion_dispatched).toBe(true);
    expect(decision.level).toBe(0);
    expect(decision.actions[0].type).toBe('log_event');
    expect(decision.actions[0].params.event_type).toBe('suggestion_dispatched');

    // 验证 INSERT 被调用
    const insertCall = mockPool._client.query.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeTruthy();

    // 验证 UPDATE suggestions
    const updateCall = mockPool._client.query.mock.calls.find(
      ([sql]) => sql.includes('UPDATE suggestions')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0]).toBe('sug-001');
  });

  it('T2: 去重 — 已有 in_flight 任务时跳过，返回 _suggestion_dispatched=false', async () => {
    const mockPool = buildMockPool({ inFlight: [{ id: 'existing-task' }], queueCount: 0 });
    pool.query = mockPool.query;
    pool.connect = mockPool.connect;

    const decision = await processEvent(makeSuggestionEvent());

    expect(decision._suggestion_dispatched).toBe(false);
    expect(decision.actions[0].type).toBe('no_action');
    expect(decision.rationale).toMatch(/去重/);

    // 不应创建新任务
    const insertCall = mockPool._client.query.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeFalsy();
  });

  it('T3: 速率限制 — 队列积压 >= 5 时跳过，返回 _suggestion_dispatched=false', async () => {
    const mockPool = buildMockPool({ inFlight: [], queueCount: 5 });
    pool.query = mockPool.query;
    pool.connect = mockPool.connect;

    const decision = await processEvent(makeSuggestionEvent());

    expect(decision._suggestion_dispatched).toBe(false);
    expect(decision.rationale).toMatch(/速率限制/);

    const insertCall = mockPool._client.query.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeFalsy();
  });

  it('T4: domain/owner_role 正确传递到 INSERT', async () => {
    const mockPool = buildMockPool({ inFlight: [], queueCount: 0 });
    pool.query = mockPool.query;
    pool.connect = mockPool.connect;

    await processEvent(makeSuggestionEvent({ domain: 'coding', owner_role: 'cto' }));

    const insertCall = mockPool._client.query.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeTruthy();
    const params = insertCall[1];
    expect(params[3]).toBe('coding');   // domain
    expect(params[4]).toBe('cto');      // owner_role
  });

  it('T5: INSERT 失败时回滚并返回 fallback decision', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.trim() === 'BEGIN') return { rows: [] };
        if (sql.includes('INSERT INTO tasks')) throw new Error('DB 连接断开');
        if (/COMMIT|ROLLBACK/i.test(sql)) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('suggestion_plan') && sql.includes('in_progress')) return { rows: [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] };
      if (sql.includes('cecelia_events')) return { rows: [] };
      return { rows: [] };
    });
    pool.connect = vi.fn(async () => client);

    const decision = await processEvent(makeSuggestionEvent());

    // fallback decision — 不抛出，而是优雅降级
    expect(decision).toBeTruthy();
    expect(decision._suggestion_dispatched).toBeFalsy();

    // 验证 ROLLBACK 被调用
    const rollbackCall = client.query.mock.calls.find(([sql]) => /ROLLBACK/i.test(sql));
    expect(rollbackCall).toBeTruthy();
  });
});
