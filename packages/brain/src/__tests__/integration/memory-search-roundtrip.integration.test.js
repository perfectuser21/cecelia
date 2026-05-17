/**
 * Integration Test: Memory Search Roundtrip
 *
 * 验证闭环：直接写入 tasks 表 → POST /api/brain/memory/search 搜索 → 验证找到 → 清理
 *
 * 关键约束：
 * - mock openai-client.js（CI 无 OpenAI API Key）→ 触发 Jaccard fallback
 * - 直接用 pg.Pool 写入测试数据（memory 无 store 端点）
 * - 测试 task status 必须是 'pending'（Jaccard 只扫 pending/in_progress/completed）
 * - title + description 需与搜索词有足够 token 重叠，score > 0.3
 * - afterAll 通过 task ID 精确清理测试数据
 *
 * 运行环境: brain-integration CI job（pgvector/pgvector:pg15 + 迁移已跑）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock openai-client.js（CI 无 OpenAI Key，强制走 Jaccard fallback）─────────

vi.mock('../../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockRejectedValue(new Error('OpenAI API not available in test')),
}));

// ─── 真实 DB 连接池 ──────────────────────────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录插入的测试 task ID，afterAll 统一清理
let testTaskId;

// 唯一标识前缀，避免与其他测试数据冲突
const UNIQUE_MARKER = `memory-roundtrip-test-${Date.now()}`;

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const memoryRouter = await import('../../routes/memory.js').then(m => m.default);
  app.use('/api/brain/memory', memoryRouter);

  return app;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Memory Search Roundtrip — 存入→搜索→验证检索到（真实 PostgreSQL）', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();

    // 直接往 tasks 表写入测试数据
    // 注意：tokenize() 按空格拆分，连续中文串会成一个 token，Jaccard 匹配率低。
    // 使用英文词汇确保 token 重叠度高（Jaccard score > 0.3）：
    //   query "memory roundtrip integration test authentication" → 5 tokens
    //   title + description 包含相同词汇 → union 小，intersection 大 → score ≈ 0.7
    const result = await testPool.query(
      `INSERT INTO tasks (title, description, status, task_type, priority, trigger_source)
       VALUES ($1, $2, 'pending', 'dev', 'P2', 'api')
       RETURNING id`,
      [
        `[${UNIQUE_MARKER}] memory roundtrip integration test authentication login verification`,
        `memory search roundtrip integration test authentication login jwt token verification unique test data ${UNIQUE_MARKER}`,
      ]
    );

    testTaskId = result.rows[0].id;
  }, 20000);

  afterAll(async () => {
    // 精确清理测试写入的数据
    if (testTaskId) {
      await testPool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }
    await testPool.end();
  });

  // ─── 测试 1: 闭环——搜索结果包含刚写入的 task ─────────────────────────────

  it('POST /api/brain/memory/search — 搜索结果包含刚写入的测试 task（通过 ID 匹配）', async () => {
    // 使用与 task title/description 有大量 token 重叠的英文查询（Jaccard score ≈ 0.7 > 0.3 阈值）
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: 'memory roundtrip integration test authentication', topK: 20 })
      .expect(200);

    expect(res.body).toHaveProperty('matches');
    expect(Array.isArray(res.body.matches)).toBe(true);

    // 通过 task ID 匹配，验证刚写入的 task 在结果中
    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();
  });

  // ─── 测试 2: 返回字段完整性 ──────────────────────────────────────────────

  it('搜索结果包含预期字段 id/level/title/similarity/preview', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: 'memory roundtrip integration test authentication', topK: 20 })
      .expect(200);

    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();

    // 验证所有必填字段存在
    expect(found).toHaveProperty('id');
    expect(found).toHaveProperty('level');
    expect(found).toHaveProperty('title');
    expect(found).toHaveProperty('similarity');
    expect(found).toHaveProperty('preview');

    // 验证字段类型和值
    expect(typeof found.id).toBe('string');
    expect(found.level).toBe('task');
    expect(typeof found.title).toBe('string');
    expect(found.title).toContain(UNIQUE_MARKER);
  });

  // ─── 测试 3: similarity score 有效性 ─────────────────────────────────────

  it('搜索结果的 similarity 分数在有效范围 (0, 1] 内', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: 'memory roundtrip integration test authentication', topK: 20 })
      .expect(200);

    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();

    // similarity > 0 证明搜索有效（不是随机结果）
    // similarity <= 1 证明分数在合法范围内
    expect(found.similarity).toBeGreaterThan(0);
    expect(found.similarity).toBeLessThanOrEqual(1);
  });

  // ─── 测试 4: query 参数校验 ──────────────────────────────────────────────

  it('POST /api/brain/memory/search — 缺少 query 参数返回 400', async () => {
    await request(app)
      .post('/api/brain/memory/search')
      .send({ topK: 5 })
      .expect(400);
  });

  // ─── 测试 5: 搜索响应结构 ────────────────────────────────────────────────

  it('搜索响应顶层结构含 matches 数组', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: 'memory roundtrip integration test authentication', topK: 5 })
      .expect(200);

    expect(res.body).toHaveProperty('matches');
    expect(Array.isArray(res.body.matches)).toBe(true);
    // topK=5，结果数量 ≤ 5
    expect(res.body.matches.length).toBeLessThanOrEqual(5);
  });
});
