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
import express from 'express';
import request from 'supertest';

// ── Mock pool ──────────────────────────────────────────────
vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

// ── Mock claude spawn（PR2 conversation-agent 依赖）──────────
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({
    status: 0,
    stdout: JSON.stringify({ type: 'result', result: '好的 [TURN: chat]', session_id: 'sess-mock-1' }) + '\n',
    stderr: '',
  })),
}));

import pool from '../../db.js';
import conversationsRouter from '../conversations.js';

// 辅助：创建 express app
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/conversations', conversationsRouter);
  return app;
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
  beforeEach(() => vi.clearAllMocks());

  it('传入合法 journey_id → 201 + status=active + turn_count=0', async () => {
    // journey 存在检查 → 返回 1 行
    pool.query.mockResolvedValueOnce({ rows: [{ id: FAKE_JOURNEY_ID }] });
    // INSERT conversation → 返回新行
    pool.query.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });

    const res = await request(makeApp())
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

    pool.query.mockResolvedValueOnce({ rows: [{ id: FAKE_JOURNEY_ID }] });
    pool.query.mockResolvedValueOnce({ rows: [convWith48h] });

    const res = await request(makeApp())
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
  beforeEach(() => vi.clearAllMocks());

  it('缺失 journey_id → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/conversations')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('journey_id 为空字符串 → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/conversations')
      .send({ journey_id: '' });

    expect(res.status).toBe(400);
  });

  it('journey_id 非 UUID 格式 → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/conversations')
      .send({ journey_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('journey_id 不存在于 journeys 表 → 404', async () => {
    // journey 存在检查 → 返回 0 行
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp())
      .post('/api/brain/conversations')
      .send({ journey_id: '00000000-0000-4000-a000-999999999999' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-5] GET 列表按 journey_id 过滤
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-5] GET /api/brain/conversations — 列表过滤', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按 journey_id 返回 conversations 数组 + total', async () => {
    const convWithExtras = {
      ...FAKE_CONVERSATION,
      last_message: '你好',
      last_message_at: new Date().toISOString(),
      related_decision_count: 0,
    };

    pool.query.mockResolvedValueOnce({ rows: [convWithExtras], rowCount: 1 });
    // total count 查询
    pool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(makeApp())
      .get(`/api/brain/conversations?journey_id=${FAKE_JOURNEY_ID}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversations)).toBe(true);
    expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.conversations[0].journey_id).toBe(FAKE_JOURNEY_ID);
  });

  it('不传 journey_id → 400', async () => {
    const res = await request(makeApp()).get('/api/brain/conversations');
    expect(res.status).toBe(400);
  });

  it('status 过滤参数有效', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(makeApp())
      .get(`/api/brain/conversations?journey_id=${FAKE_JOURNEY_ID}&status=resolved`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversations)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-6] GET 单条包含 messages 数组
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-6] GET /api/brain/conversations/:id — 单条 + messages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 conversation + messages 数组 + decisions 数组', async () => {
    // 获取 conversation
    pool.query.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 获取 messages（最近 50 条）
    pool.query.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });
    // 获取 decisions（related_decision_ids = []，返回空数组）
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get(`/api/brain/conversations/${FAKE_CONV_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(FAKE_CONV_ID);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(Array.isArray(res.body.decisions)).toBe(true);
  });

  it('conversation 不存在 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get(`/api/brain/conversations/${FAKE_CONV_ID}`);

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-3] PATCH — status 枚举校验
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] PATCH /api/brain/conversations/:id — status 枚举校验', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无效 status → 400', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it.each(['active', 'resolved', 'suspended', 'archived'])(
    '合法 status "%s" → 200',
    async (validStatus) => {
      const updated = { ...FAKE_CONVERSATION, status: validStatus };
      pool.query.mockResolvedValueOnce({ rows: [updated] });

      const res = await request(makeApp())
        .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
        .send({ status: validStatus });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(validStatus);
    }
  );

  it('conversation 不存在 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp())
      .patch(`/api/brain/conversations/${FAKE_CONV_ID}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// [BEHAVIOR-2] POST messages — turn_count 自增
// ──────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] POST /api/brain/conversations/:id/messages — turn_count 自增', () => {
  beforeEach(() => vi.clearAllMocks());

  it('role=user → 201 + turn_count 自增 1 + 触发 agent 调用', async () => {
    // 检查 conversation 存在（含锚点坐标）
    pool.query.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 插入 user 消息
    pool.query.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });
    // turn_count +1 UPDATE
    pool.query.mockResolvedValueOnce({ rows: [{ ...FAKE_CONVERSATION, turn_count: 1 }] });
    // 插入 assistant 回复（agent 调用产出）
    pool.query.mockResolvedValueOnce({ rows: [] });
    // 写回 current_session_id
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp())
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user', content: '测试消息' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.role).toBe('user');

    // 第 4 次 query 应为插入 assistant 回复
    const assistantInsertCall = pool.query.mock.calls[3];
    expect(assistantInsertCall[0]).toContain("'assistant'");
    expect(assistantInsertCall[1]).toContain('好的 [TURN: chat]');

    // 第 5 次 query 应为写回 current_session_id
    const sessionUpdateCall = pool.query.mock.calls[4];
    expect(sessionUpdateCall[0]).toContain('current_session_id');
    expect(sessionUpdateCall[1]).toContain('sess-mock-1');
  });

  it('role=assistant → 201，turn_count 不自增', async () => {
    const assistantMsg = { ...FAKE_MESSAGE, role: 'assistant' };

    // 检查 conversation 存在
    pool.query.mockResolvedValueOnce({ rows: [FAKE_CONVERSATION] });
    // 插入消息（不调用 turn_count UPDATE）
    pool.query.mockResolvedValueOnce({ rows: [assistantMsg] });

    const res = await request(makeApp())
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'assistant', content: 'AI 回复' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('assistant');
    // turn_count UPDATE 应只被调用 2 次（无 UPDATE 调用）
    const updateCallCount = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('turn_count')
    ).length;
    expect(updateCallCount).toBe(0);
  });

  it('role 非法值 → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'invalid_role', content: '测试' });

    expect(res.status).toBe(400);
  });

  it('缺少 content → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user' });

    expect(res.status).toBe(400);
  });

  it('conversation 不存在 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp())
      .post(`/api/brain/conversations/${FAKE_CONV_ID}/messages`)
      .send({ role: 'user', content: '测试' });

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// GET /messages — 分页
// ──────────────────────────────────────────────────────────
describe('GET /api/brain/conversations/:id/messages — 分页消息列表', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 messages 数组 + has_more=false（数量不足 limit）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FAKE_MESSAGE] });

    const res = await request(makeApp())
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
    pool.query.mockResolvedValueOnce({ rows: msgs });

    const res = await request(makeApp())
      .get(`/api/brain/conversations/${FAKE_CONV_ID}/messages?limit=50`);

    expect(res.status).toBe(200);
    expect(res.body.has_more).toBe(true);
    expect(res.body.messages.length).toBe(50);
  });
});
