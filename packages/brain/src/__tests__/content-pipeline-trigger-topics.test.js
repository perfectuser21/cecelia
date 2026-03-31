/**
 * content-pipeline-trigger-topics.test.js
 *
 * 验证 feat(brain): 启动每日AI内容生成调度引擎的核心功能：
 *   1. POST /api/brain/pipelines/trigger-topics 端点已注册
 *   2. 今日已有选题时跳过（返回 skipped: true）
 *   3. 强制触发时（?force=1）绕过跳过检查
 *   4. migration 203 topic_selection_log 表 DDL 正确
 *   5. server.js 注册了 contentPipelineRoutes
 *
 * 对应 PR: feat(brain): 启动每日AI内容生成调度引擎（migration 203 + trigger-topics API）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn().mockResolvedValue([]),
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn().mockReturnValue([]),
}));

// Mock topic-selection-scheduler
vi.mock('../topic-selection-scheduler.js', () => ({
  triggerDailyTopicSelection: vi.fn(),
  hasTodayTopics: vi.fn(),
}));

// Mock content-pipeline-orchestrator
vi.mock('../content-pipeline-orchestrator.js', () => ({
  orchestrateContentPipelines: vi.fn().mockResolvedValue({}),
  executeQueuedContentTasks: vi.fn().mockResolvedValue({ executed: 0 }),
}));

// Mock llm-caller
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

import { hasTodayTopics, triggerDailyTopicSelection } from '../topic-selection-scheduler.js';
import contentPipelineRouter from '../routes/content-pipeline.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/pipelines', contentPipelineRouter);
  app.use('/api/brain', contentPipelineRouter);
  return app;
}

// ─── migration 203 DDL 验证 ───────────────────────────────────────────────────

describe('migration 203 — topic_selection_log 表', () => {
  it('203_topic_selection_log.sql 文件存在', () => {
    const path = join(__dirname, '../../migrations/203_topic_selection_log.sql');
    expect(() => readFileSync(path)).not.toThrow();
  });

  it('包含 CREATE TABLE IF NOT EXISTS topic_selection_log', () => {
    const path = join(__dirname, '../../migrations/203_topic_selection_log.sql');
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS topic_selection_log');
  });

  it('包含 selected_date 和 keyword 字段', () => {
    const path = join(__dirname, '../../migrations/203_topic_selection_log.sql');
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('selected_date');
    expect(sql).toContain('keyword');
  });
});

// ─── server.js 路由注册验证 ───────────────────────────────────────────────────

describe('server.js — contentPipelineRoutes 注册', () => {
  it('server.js 包含 contentPipelineRoutes 导入', () => {
    const content = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    expect(content).toContain('contentPipelineRoutes');
  });

  it('server.js 挂载 /api/brain/pipelines 端点', () => {
    const content = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    expect(content).toContain('/api/brain/pipelines');
  });

  it('server.js 挂载 /api/brain 端点（用于 content-types）', () => {
    const content = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    expect(content).toContain('/api/brain/content-types') || expect(content).toContain("app.use('/api/brain'");
  });
});

// ─── POST /trigger-topics 端点行为 ───────────────────────────────────────────

describe('POST /api/brain/pipelines/trigger-topics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('今日已有选题且无 force 参数时返回 skipped: true', async () => {
    hasTodayTopics.mockResolvedValue(true);
    const res = await request(makeApp())
      .post('/api/brain/pipelines/trigger-topics');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toContain('今日选题已生成');
  });

  it('今日无选题时触发选题生成（调用 triggerDailyTopicSelection）', async () => {
    hasTodayTopics.mockResolvedValue(false);
    triggerDailyTopicSelection.mockResolvedValue({ triggered: 3, skipped: false });
    const res = await request(makeApp())
      .post('/api/brain/pipelines/trigger-topics');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(triggerDailyTopicSelection).toHaveBeenCalled();
  });

  it('?force=1 参数绕过"今日已有"检查，强制触发', async () => {
    hasTodayTopics.mockResolvedValue(true);
    triggerDailyTopicSelection.mockResolvedValue({ triggered: 5, skipped: false });
    const res = await request(makeApp())
      .post('/api/brain/pipelines/trigger-topics?force=1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(triggerDailyTopicSelection).toHaveBeenCalled();
  });

  it('triggerDailyTopicSelection 抛出异常时返回 500', async () => {
    hasTodayTopics.mockResolvedValue(false);
    triggerDailyTopicSelection.mockRejectedValue(new Error('DB 连接失败'));
    const res = await request(makeApp())
      .post('/api/brain/pipelines/trigger-topics');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('DB 连接失败');
  });
});
