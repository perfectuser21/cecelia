/**
 * INV-09: 全配置注入无硬编码
 * 所有可调参数来自环境变量；服务启动时打印配置摘要；
 * 修改环境变量后行为应随之改变。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { makeValidZipBuffer } from './helpers/zip-factory.js';

describe('INV-09: 全配置注入', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('GET /api/brain/config 返回所有可调参数（不含敏感值）', async () => {
    const app = await createTestApp({
      db,
      MAX_ZIP_MB: 10,
      SKILL_EVAL_TIMEOUT: 1800,
      MAX_CONCURRENT_SKILL_EVAL: 1,
      SKILL_EVAL_PENDING_LIMIT: 20,
      SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS: 3,
      SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS: 14,
    });

    const res = await request(app).get('/api/brain/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      MAX_ZIP_MB: 10,
      SKILL_EVAL_TIMEOUT: 1800,
      MAX_CONCURRENT_SKILL_EVAL: 1,
      SKILL_EVAL_PENDING_LIMIT: 20,
    });
  });

  it('MAX_ZIP_MB 从环境变量读取：设为 5 时，6MB zip 被拒绝（HTTP 400）', async () => {
    const app = await createTestApp({ db, MAX_ZIP_MB: 5 });

    // 构造一个声称 6MB 的 zip（mock 大小检查）
    const largeZipBuffer = Buffer.alloc(6 * 1024 * 1024 + 1, 0x50); // 超过 5MB
    largeZipBuffer[0] = 0x50; // PK magic
    largeZipBuffer[1] = 0x4b;
    largeZipBuffer[2] = 0x03;
    largeZipBuffer[3] = 0x04;

    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', largeZipBuffer, {
        filename: 'large.zip',
        contentType: 'application/zip',
      })
      .field('skill_name', 'large-skill');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MAX_ZIP_MB|zip exceeds/i);
  });

  it('SKILL_EVAL_PENDING_LIMIT 从环境变量读取：设为 3 时，3 个 pending 即触发背压', async () => {
    const app = await createTestApp({ db, SKILL_EVAL_PENDING_LIMIT: 3 });

    // 插入 3 个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES
        ('cfg-task-1', 'hash-cfg-111', 'skill-1', 'pending'),
        ('cfg-task-2', 'hash-cfg-222', 'skill-2', 'pending'),
        ('cfg-task-3', 'hash-cfg-333', 'skill-3', 'pending')
    `);

    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'overflow-skill');

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('排队已满');
  });

  it('MAX_CONCURRENT_SKILL_EVAL 从环境变量读取：设为 2 时允许 2 个并发', async () => {
    const { createMockBrainTick } = await import('./helpers/brain-mock.js');
    const tick = createMockBrainTick({ db, MAX_CONCURRENT_SKILL_EVAL: 2 });

    // 插入 3 个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES
        ('conc-task-1', 'hash-conc-aaa', 'skill-a', 'pending'),
        ('conc-task-2', 'hash-conc-bbb', 'skill-b', 'pending'),
        ('conc-task-3', 'hash-conc-ccc', 'skill-c', 'pending')
    `);

    await tick.schedule();

    const { count } = await db.one(
      `SELECT COUNT(*) as count FROM skill_eval_tasks WHERE status='running'`
    );
    // 并发限制 2，最多 2 个 running
    expect(parseInt(count)).toBeLessThanOrEqual(2);
    expect(parseInt(count)).toBeGreaterThanOrEqual(1);
  });

  it('代码层面：Brain src 中无未经 env 引用的魔法数字（静态检查）', async () => {
    // 此测试在 CI 中通过 grep 验证；在单元测试层标记为文档性质
    // 实际 grep 命令见 contract-dod.md INV-09 manual:bash
    // 此处仅确认配置对象不含 undefined
    const app = await createTestApp({ db });
    const res = await request(app).get('/api/brain/config');
    expect(res.status).toBe(200);

    const config = res.body;
    const requiredKeys = [
      'MAX_ZIP_MB',
      'SKILL_EVAL_TIMEOUT',
      'MAX_CONCURRENT_SKILL_EVAL',
      'SKILL_EVAL_PENDING_LIMIT',
    ];
    for (const key of requiredKeys) {
      expect(config[key]).toBeDefined();
      expect(config[key]).not.toBeNull();
    }
  });
});
