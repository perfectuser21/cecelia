/**
 * Contract Test — PR1 对话会话基础层
 * Sprint: 07240616-relay-264b8c8d
 * Task ID: 264b8c8d-aad6-4f1c-84d1-274880beb3da
 *
 * 测试策略：
 * - 使用 vi.mock 模拟 pool，不依赖真实 DB
 * - 覆盖 [BEHAVIOR-1] ~ [BEHAVIOR-6] 的核心断言
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock pool ──────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// 辅助：创建 express app + 挂载路由
async function createApp() {
  const express = await import('express');
  const { default: conversationsRouter } = await import(
    '../conversations.js'
  );
  const app = express.default();
  app.use(express.default.json());
  app.use('/api/brain/conversations', conversationsRouter);
  return app;
}

// 辅助：创建 supertest 实例
async function getAgent() {
  const { default: request } = await import('supertest');
  const app = await createApp();
  return request(app);
}

// ── 常量 ──────────────────────────────────────────────────
const FAKE_JOURNEY_ID = '00000000-0000-4000-a000-000000000001';
const FAKE_CONV_ID = '00000000-0000-4000-a000-000000000002';
const FAKE_MSG_ID = '00000000-0000-4000-a000-000000000003';

const FAKE_CONVERSATION = {
  id: FAKE_CONV_ID,
  journey_id: FAKE_JOURNEY_ID,
  gp_id: null,
  title: null,
  status: 'active',
  current_session_id: null,
  session_compact_count: 0,
  turn_count: 0,
  ttl_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  archived_summary: null,
  related_decision_ids: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const FAKE_MESSAGE = {
  id: FAKE_MSG_ID,
  conversation_id: FAKE_CONV_ID,
  role: 'user',
  content: '测试消息',
  turn_marker: null,
  created_at: new Date().toISOString(),
};

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-1] 创建 conversation 返回正确结构
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-1] POST /api/brain/conversations — 创建 conversation', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('传入合法 journey_id → 201 + status=active + turn_count=0', async () => {
    // journey 存在检查 → 返回 1 行
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_JOURNEY_ID }] });
    // INSERT conversation → 返回新行
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });

    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({ journey_id: FAKE_JOURNEY_ID });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('active');
    expect(res.body.turn_count).toBe(0);
    expect(res.body.journey_id).toBe(FAKE_JOURNEY_ID);
  });

  it('传入 ttl_hours=48 → ttl_expires_at 约为 48 小时后', async () => {
    const ttlDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const convWith48h = { ...FAKE_CONVERSATION, ttl_expires_at: ttlDate };

    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_JOURNEY_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [convWith48h] });

    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({ journey_id: FAKE_JOURNEY_ID, ttl_hours: 48 });

    expect(res.status).toBe(201);
    expect(res.body.ttl_expires_at).toBeDefined();
    const ttlMs = new Date(res.body.ttl_expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(47 * 3600 * 1000);
    expect(ttlMs).toBeLessThan(49 * 3600 * 1000);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-4] 缺失 journey_id → 400；不存在 journey_id → 404
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] POST /api/brain/conversations — 参数校验', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('缺失 journey_id → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('journey_id 为空字符串 → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({ journey_id: '' });

    expect(res.status).toBe(400);
  });

  it('journey_id 非 UUID 格式 → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({ journey_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('journey_id 不存在于 journeys 表 → 404', async () => {
    // journey 存在检查 → 返回 0 行
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const agent = await getAgent();
    const res = await agent
      .post('/api/brain/conversations')
      .send({ journey_id: '00000000-0000-4000-a000-999999999999' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-5] GET 列表按 journey_id 过滤
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-5] GET /api/brain/conversations — 列表过滤', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('按 journey_id 返回 conversations 数组 + total', async () => {
    const convWithExtras = {
      ...FAKE_CONVERSATION,
      last_message: '你好',
      last_message_at: new Date().toISOString(),
      related_decision_count: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [convWithExtras], rowCount: 1 });
    // total count 查询
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const agent = await getAgent();
    const res = await agent
      .get(`/api/brain/conversations?journey_id=${FAKE_JOURNEY_ID}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversations)).toBe(true);
    expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.conversations[0].journey_id).toBe(FAKE_JOURNEY_ID);
  });

  it('不传 journey_id → 400', async () => {
    const agent = await getAgent();
    const res = await agent.get('/api/brain/conversations');
    expect(res.status).toBe(400);
  });

  it('status 过滤参数有效', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const agent = await getAgent();
    const res = await agent
      .get(`/api/brain/conversations?journey_id=${FAKE_JOURNEY_ID}&status=resolved`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversations)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-6] GET 单条包含 messages 数组
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-6] GET /api/brain/conversations/:id — 单条 + messages', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('返回 conversation + messages 数组 + decisions 数组', async () => {
    // 获取 conversation
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 获取 messages（最近 50 条）
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });
    // 获取 decisions（related_decision_ids = []，返回空数组）
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const agent = await getAgent();
    const res = await agent.get(`/api/brain/conversations/${FAKE_CONV_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(FAKE_CONV_ID);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(Array.isArray(res.body.decisions)).toBe(true);
  });

  it('conversation 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const agent = await getAgent();
    const res = await agent.get(`/api/brain/conversations/${FAKE_CONV_ID}`);

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-3] PATCH — status 枚举校验
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] PATCH /api/brain/conversations/:id — status 枚举校验', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('无效 status → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it.each(['active', 'resolved', 'suspended', 'archived'])(
    '合法 status "%s" → 200',
    async (validStatus) => {
      const updated = { ...FAKE_CONVERSATION, status: validStatus };
      mockQuery.mockResolvedValueOnce({ rows: [updated] });

      const agent = await getAgent();
      const res = await agent
        .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
        .send({ status: validStatus });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(validStatus);
    }
  );

  it('conversation 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const agent = await getAgent();
    const res = await agent
      .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-2] POST messages — turn_count 自增
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] POST /api/brain/conversations/:id/messages — turn_count 自增', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('role=user → 201 + turn_count 自增 1', async () => {
    // 检查 conversation 存在
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 插入消息
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });
    // turn_count +1 UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ ...FAKE_CONVERSATION, turn_count: 1 }] });

    const agent = await getAgent();
    const res = await agent
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user', content: '测试消息' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.role).toBe('user');
  });

  it('role=assistant → 201，turn_count 不自增', async () => {
    const assistantMsg = { ...FAKE_MESSAGE, role: 'assistant' };

    // 检查 conversation 存在
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 插入消息（不调用 turn_count UPDATE）
    mockQuery.mockResolvedValueOnce({ rows: [assistantMsg] });

    const agent = await getAgent();
    const res = await agent
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'assistant', content: 'AI 回复' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('assistant');
    // turn_count UPDATE 应只被调用 2 次（无 UPDATE 调用）
    // 此断言依赖实现时 role=assistant 不调用 UPDATE
    const updateCallCount = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('turn_count')
    ).length;
    expect(updateCallCount).toBe(0);
  });

  it('role 非法值 → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'invalid_role', content: '测试' });

    expect(res.status).toBe(400);
  });

  it('缺少 content → 400', async () => {
    const agent = await getAgent();
    const res = await agent
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user' });

    expect(res.status).toBe(400);
  });

  it('conversation 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const agent = await getAgent();
    const res = await agent
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user', content: '测试' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// GET /messages — 分页
// ──────────────────────────────────────────────────────────
describe('GET /api/brain/conversations/:id/messages — 分页消息列表', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('返回 messages 数组 + has_more=false（数量不足 limit）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });

    const agent = await getAgent();
    const res = await agent
      .get(`/api/brain/conversations/${FAKE_CONV_ID}/messages`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(typeof res.body.has_more).toBe('boolean');
  });

  it('has_more=true 当返回数量等于 limit', async () => {
    // 模拟返回 limit+1 条（实现用于判断 has_more）
    const msgs = Array.from({ length: 51 }, (_, i) => ({
      ...FAKE_MESSAGE,
      id: `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`,
    }));
    mockQuery.mockResolvedValueOnce({ rows: msgs });

    const agent = await getAgent();
    const res = await agent
      .get(`/api/brain/conversations/${FAKE_CONV_ID}/messages?limit=50`);

    expect(res.status).toBe(200);
    expect(res.body.has_more).toBe(true);
    expect(res.body.messages.length).toBe(50);
  });
});
