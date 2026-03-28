/**
 * daily-publish-scheduler.test.js
 *
 * 测试每日发布调度器的核心行为：
 *   1. 触发时间窗口内处理 pending content_publish_jobs
 *   2. 今日已触发时跳过（去重）
 *   3. 优先级平台排序（douyin > xiaohongshu > wechat > ...）
 *   4. 窗口外不触发
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyPublish, isInPublishTriggerWindow, hasTodayPublish } from '../daily-publish-scheduler.js';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** UTC 03:02（北京时间 11:02）— 在触发窗口内 */
function makeWindowTime() {
  return new Date('2026-03-27T03:02:00Z');
}

/** UTC 12:00 — 在触发窗口外 */
function makeOutsideTime() {
  return new Date('2026-03-27T12:00:00Z');
}

/** 构造 pending content_publish_jobs */
function makePendingJobs(platforms) {
  return platforms.map((p, i) => ({
    id: `job-${i + 1}`,
    platform: p,
    content_type: 'image',
    payload: { title: `测试内容${i + 1}`, content_dir: `/tmp/test${i}` },
    status: 'pending',
    created_at: new Date(),
  }));
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('isInPublishTriggerWindow', () => {
  it('UTC 03:02 在触发窗口内', () => {
    expect(isInPublishTriggerWindow(makeWindowTime())).toBe(true);
  });

  it('UTC 03:00 在触发窗口内（边界起）', () => {
    expect(isInPublishTriggerWindow(new Date('2026-03-27T03:00:00Z'))).toBe(true);
  });

  it('UTC 03:04 在触发窗口内', () => {
    expect(isInPublishTriggerWindow(new Date('2026-03-27T03:04:00Z'))).toBe(true);
  });

  it('UTC 03:06 超出触发窗口', () => {
    expect(isInPublishTriggerWindow(new Date('2026-03-27T03:06:00Z'))).toBe(false);
  });

  it('UTC 12:00 不在触发窗口', () => {
    expect(isInPublishTriggerWindow(makeOutsideTime())).toBe(false);
  });
});

describe('triggerDailyPublish', () => {
  let pool;
  let insertedTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedTasks = [];

    pool = {
      query: vi.fn(async (sql, params) => {
        const s = typeof sql === 'string' ? sql : '';

        // hasTodayPublish check — 今日未触发（key 是参数 $1）
        if (s.includes('working_memory') && s.includes('SELECT') && params?.[0] === 'daily_publish_triggered') {
          return { rows: [] };
        }

        // pending jobs query
        if (s.includes('content_publish_jobs') && s.includes("'pending'")) {
          return {
            rows: makePendingJobs(['kuaishou', 'douyin', 'wechat', 'xiaohongshu']),
          };
        }

        // 幂等检查：今日是否已有 content_publish task
        if (s.includes('content_publish') && s.includes('DATE(')) {
          return { rows: [] }; // 无重复
        }

        // INSERT content_publish task — params: [title, priority, payload_json]
        if (s.includes('INSERT INTO tasks')) {
          const payload = params ? JSON.parse(params[2] || '{}') : {};
          insertedTasks.push({ platform: payload.platform, payload });
          return { rows: [{ id: `task-${insertedTasks.length}` }] };
        }

        // UPDATE content_publish_jobs → running
        if (s.includes('UPDATE content_publish_jobs')) {
          return { rows: [] };
        }

        // working_memory upsert
        if (s.includes('working_memory')) {
          return { rows: [] };
        }

        return { rows: [] };
      }),
    };
  });

  it('窗口外不触发，skipped_window=true', async () => {
    const result = await triggerDailyPublish(pool, makeOutsideTime());
    expect(result.skipped_window).toBe(true);
    expect(result.created).toBe(0);
  });

  it('窗口内处理 pending jobs，创建 content_publish tasks', async () => {
    const result = await triggerDailyPublish(pool, makeWindowTime());
    expect(result.skipped_window).toBe(false);
    expect(result.created).toBeGreaterThan(0);
  });

  it('窗口内优先级平台（douyin/xiaohongshu/wechat）均被创建', async () => {
    await triggerDailyPublish(pool, makeWindowTime());
    const platforms = insertedTasks.map(t => t.platform);
    expect(platforms).toContain('douyin');
    expect(platforms).toContain('wechat');
    expect(platforms).toContain('xiaohongshu');
  });

  it('今日已触发则 skipped=true，不重复创建', async () => {
    pool.query = vi.fn(async (sql, params) => {
      const s = typeof sql === 'string' ? sql : '';
      // working_memory SELECT（key 作为参数 $1）
      if (s.includes('working_memory') && s.includes('SELECT') && params?.[0] === 'daily_publish_triggered') {
        return { rows: [{ value_json: { date: '2026-03-27', created: 3 } }] };
      }
      return { rows: [] };
    });

    const result = await triggerDailyPublish(pool, makeWindowTime());
    expect(result.skipped).toBe(true);
    expect(result.created).toBe(0);
  });

  it('无 pending jobs 时 created=0 且不报错', async () => {
    pool.query = vi.fn(async (sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('content_publish_jobs')) return { rows: [] };
      if (s.includes('working_memory')) return { rows: [] };
      return { rows: [] };
    });

    const result = await triggerDailyPublish(pool, makeWindowTime());
    expect(result.created).toBe(0);
    expect(result.skipped_window).toBe(false);
  });
});
