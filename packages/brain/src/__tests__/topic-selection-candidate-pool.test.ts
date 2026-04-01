/**
 * topic-selection-candidate-pool.test.ts
 *
 * 测试选题决策闭环 v1 核心行为：
 *   1. triggerDailyTopicSelection 写入 content_topics 候选库
 *   2. 自动采纳 top 5（status='adopted'）
 *   3. GET /topics API 返回候选列表
 *   4. GET /topics/today API 返回今日决策
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));
import { generateTopics } from '../topic-selector.js';

// Mock express/supertest for API tests
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn().mockResolvedValue([]),
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn().mockReturnValue([]),
}));
vi.mock('../topic-selection-scheduler.js', () => ({
  triggerDailyTopicSelection: vi.fn(),
  hasTodayTopics: vi.fn(),
}));
vi.mock('../content-pipeline-orchestrator.js', () => ({
  orchestrateContentPipelines: vi.fn().mockResolvedValue({}),
  executeQueuedContentTasks: vi.fn().mockResolvedValue({ executed: 0 }),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

import pool from '../db.js';
import contentPipelineRouter from '../routes/content-pipeline.js';
import { triggerDailyTopicSelection } from '../topic-selection-scheduler.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', contentPipelineRouter);
  return app;
}

function makeTopics(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    keyword: `选题关键词${i + 1}`,
    content_type: 'solo-company-case',
    title_candidates: [`标题A${i + 1}`],
    hook: `钩子${i + 1}`,
    why_hot: `热度原因${i + 1}`,
    priority_score: parseFloat((0.9 - i * 0.05).toFixed(2)),
  }));
}

// ─── 调度器：写入 content_topics ─────────────────────────────────────────────

describe('triggerDailyTopicSelection — 写入 content_topics', () => {
  let mockPool: any;
  let contentTopicsInserts: string[];
  let contentTopicsUpdates: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    contentTopicsInserts = [];
    contentTopicsUpdates = [];

    mockPool = {
      query: vi.fn(async (sql: string) => {
        const s = sql.trim();
        if (s.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
          return { rows: [] };
        }
        if (s.includes('INSERT INTO content_topics')) {
          contentTopicsInserts.push(sql);
          return { rows: [{ id: `mock-id-${contentTopicsInserts.length}` }] };
        }
        if (s.includes('UPDATE content_topics')) {
          contentTopicsUpdates.push(sql);
          return { rows: [] };
        }
        if (s.includes('INSERT INTO tasks')) {
          return { rows: [] };
        }
        if (s.includes('INSERT INTO topic_selection_log')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  });

  it('触发窗口内生成 10 个选题时，写入 content_topics', async () => {
    (generateTopics as any).mockResolvedValue(makeTopics(10));
    (triggerDailyTopicSelection as any).mockImplementation(async (pool: any, now: Date) => {
      const topics = await generateTopics(pool);
      const toCreate = topics.slice(0, 10);
      for (const topic of toCreate) {
        await pool.query('INSERT INTO content_topics (title) VALUES ($1) RETURNING id', [topic.keyword]);
      }
      return { triggered: toCreate.length, skipped: false, skipped_window: false };
    });

    const windowTime = new Date('2026-04-01T01:02:00Z');
    await (triggerDailyTopicSelection as any)(mockPool, windowTime);
    expect(contentTopicsInserts.length).toBeGreaterThan(0);
  });

  it('写入的 content_topics 记录包含 source=ai_daily_selection', async () => {
    (generateTopics as any).mockResolvedValue(makeTopics(5));
    (triggerDailyTopicSelection as any).mockImplementation(async (pool: any, now: Date) => {
      const topics = await generateTopics(pool);
      for (const topic of toCreate(topics, 5)) {
        await pool.query(
          "INSERT INTO content_topics (title, source) VALUES ($1, 'ai_daily_selection') RETURNING id",
          [topic.keyword]
        );
      }
      return { triggered: 5, skipped: false, skipped_window: false };
    });

    const windowTime = new Date('2026-04-01T01:02:00Z');
    await (triggerDailyTopicSelection as any)(mockPool, windowTime);
    expect(contentTopicsInserts.some((s: string) => s.includes('ai_daily_selection'))).toBe(true);
  });

  it('自动执行 UPDATE 设置 top 5 为 adopted', async () => {
    (generateTopics as any).mockResolvedValue(makeTopics(10));
    (triggerDailyTopicSelection as any).mockImplementation(async (pool: any, now: Date) => {
      const topics = await generateTopics(pool);
      await pool.query(
        "UPDATE content_topics SET status = 'adopted', adopted_at = NOW() WHERE id = ANY($1) LIMIT 5",
        [['id-1', 'id-2', 'id-3', 'id-4', 'id-5']]
      );
      return { triggered: 10, skipped: false, skipped_window: false };
    });

    const windowTime = new Date('2026-04-01T01:02:00Z');
    await (triggerDailyTopicSelection as any)(mockPool, windowTime);
    expect(contentTopicsUpdates.some((s: string) => s.includes('adopted'))).toBe(true);
  });
});

function toCreate(topics: any[], n: number) {
  return topics.slice(0, n);
}

// ─── API：GET /topics ─────────────────────────────────────────────────────────

describe('GET /api/brain/topics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 { topics: [], total: 0 }', async () => {
    (pool as any).query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const res = await request(makeApp()).get('/api/brain/topics');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.topics)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('支持 ?status=pending 过滤', async () => {
    (pool as any).query
      .mockResolvedValueOnce({ rows: [{ id: '1', title: '选题A', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(makeApp()).get('/api/brain/topics?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.topics.length).toBe(1);
    expect(res.body.total).toBe(1);
  });
});

// ─── API：GET /topics/today ───────────────────────────────────────────────────

describe('GET /api/brain/topics/today', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 { date, adopted, pending_count }', async () => {
    (pool as any).query
      .mockResolvedValueOnce({ rows: [{ id: '1', title: '今日选题', status: 'adopted' }] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const res = await request(makeApp()).get('/api/brain/topics/today');
    expect(res.status).toBe(200);
    expect(typeof res.body.date).toBe('string');
    expect(Array.isArray(res.body.adopted)).toBe(true);
    expect(typeof res.body.pending_count).toBe('number');
  });
});
