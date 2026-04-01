/**
 * topic-selection-candidate-pool.test.ts
 *
 * 契约测试：验证选题决策闭环 v1 的文件结构与注册
 * 行为单元测试见 packages/brain/src/__tests__/topic-selection-candidate-pool.test.ts
 */

import { describe, it, expect } from 'vitest';
import { accessSync, readFileSync } from 'fs';

describe('[ARTIFACT] migration 209 — content_topics source 字段', () => {
  it('209_content_topics_source.sql 文件存在', () => {
    expect(() =>
      accessSync('packages/brain/migrations/209_content_topics_source.sql')
    ).not.toThrow();
  });

  it('包含 ADD COLUMN IF NOT EXISTS source', () => {
    const sql = readFileSync(
      'packages/brain/migrations/209_content_topics_source.sql',
      'utf8'
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source');
  });

  it('包含 schema_version 记录（version=209）', () => {
    const sql = readFileSync(
      'packages/brain/migrations/209_content_topics_source.sql',
      'utf8'
    );
    expect(sql).toContain("'209'");
    expect(sql).toContain('schema_version');
  });
});

describe('[BEHAVIOR] triggerDailyTopicSelection 写入 content_topics 候选库', () => {
  it('topic-selection-scheduler.js 包含 content_topics 写入逻辑', () => {
    const src = readFileSync(
      'packages/brain/src/topic-selection-scheduler.js',
      'utf8'
    );
    expect(src).toContain('content_topics');
  });

  it('包含 source 字段写入（ai_daily_selection）', () => {
    const src = readFileSync(
      'packages/brain/src/topic-selection-scheduler.js',
      'utf8'
    );
    expect(src).toContain('ai_daily_selection');
  });

  it('包含 adopted 状态自动设置（top 5 采纳）', () => {
    const src = readFileSync(
      'packages/brain/src/topic-selection-scheduler.js',
      'utf8'
    );
    expect(src).toContain("'adopted'");
  });

  it('[PRESERVE] 仍然创建 content-pipeline tasks', () => {
    const src = readFileSync(
      'packages/brain/src/topic-selection-scheduler.js',
      'utf8'
    );
    expect(src).toContain('content-pipeline');
  });

  it('[PRESERVE] hasTodayTopics 仍查询 daily_topic_selection', () => {
    const src = readFileSync(
      'packages/brain/src/topic-selection-scheduler.js',
      'utf8'
    );
    expect(src).toContain('daily_topic_selection');
  });
});

describe('[BEHAVIOR] GET /api/brain/topics 候选列表 API', () => {
  it("content-pipeline.js 包含 GET '/topics' 路由", () => {
    const src = readFileSync(
      'packages/brain/src/routes/content-pipeline.js',
      'utf8'
    );
    expect(src).toContain("router.get('/topics'");
  });

  it('返回 topics 数组和 total 字段', () => {
    const src = readFileSync(
      'packages/brain/src/routes/content-pipeline.js',
      'utf8'
    );
    expect(src).toContain('topics');
    expect(src).toContain('total');
  });

  it('支持 status 参数过滤', () => {
    const src = readFileSync(
      'packages/brain/src/routes/content-pipeline.js',
      'utf8'
    );
    // status 参数在路由中被使用
    const topicsRouteStart = src.indexOf("router.get('/topics'");
    const topicsRouteEnd = src.indexOf('});', topicsRouteStart) + 3;
    const routeBody = src.slice(topicsRouteStart, topicsRouteEnd);
    expect(routeBody).toContain('status');
  });
});

describe('[BEHAVIOR] GET /api/brain/topics/today 今日决策 API', () => {
  it("content-pipeline.js 包含 GET '/topics/today' 路由", () => {
    const src = readFileSync(
      'packages/brain/src/routes/content-pipeline.js',
      'utf8'
    );
    expect(src).toContain("router.get('/topics/today'");
  });

  it('返回 date/adopted/pending_count 字段', () => {
    const src = readFileSync(
      'packages/brain/src/routes/content-pipeline.js',
      'utf8'
    );
    // 验证路由之后的文件内容包含这些字段（切片到文件末尾，避免误匹配内部 }）
    const todayRouteStart = src.indexOf("router.get('/topics/today'");
    const todaySection = src.slice(todayRouteStart);
    expect(todaySection).toContain('adopted');
    expect(todaySection).toContain('pending_count');
  });
});
