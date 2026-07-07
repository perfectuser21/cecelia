/**
 * INV-05: 代理令牌隔离
 * 直接访问 Brain 上传端点不带 X-Eval-Proxy-Token → HTTP 403
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { makeValidZipBuffer } from './helpers/zip-factory.js';

const VALID_TOKEN = 'test-proxy-token-secret';

describe('INV-05: 代理令牌隔离', () => {
  let app;
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    app = await createTestApp({ db, SKILL_EVAL_PROXY_TOKEN: VALID_TOKEN });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('不带 X-Eval-Proxy-Token → HTTP 403', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test');

    expect(res.status).toBe(403);
  });

  it('错误的 X-Eval-Proxy-Token → HTTP 403', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', 'wrong-token-value')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test');

    expect(res.status).toBe(403);
  });

  it('空 X-Eval-Proxy-Token → HTTP 403', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', '')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test');

    expect(res.status).toBe(403);
  });

  it('正确的 X-Eval-Proxy-Token → 进入业务逻辑（非 403）', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', VALID_TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'valid-test');

    // 应进入业务逻辑（201 创建 或 其他业务码，但不是 403）
    expect(res.status).not.toBe(403);
  });

  it('403 响应不应暴露令牌值', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', 'wrong')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test');

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(VALID_TOKEN);
  });

  it('状态查询端点不需要 Token（公开查询）', async () => {
    const res = await request(app)
      .get('/api/brain/skill-evals/non-existent-id/status');

    // 状态查询应返回 404（任务不存在），而非 403
    expect(res.status).toBe(404);
  });
});
