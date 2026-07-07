/**
 * INV-02: 背压拒绝
 * pending skill_eval ≥ 20 → 拒新，返回 HTTP 429 "排队已满"
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { makeValidZipBuffer } from './helpers/zip-factory.js';

describe('INV-02: 背压拒绝', () => {
  let app;
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    app = await createTestApp({ db, SKILL_EVAL_PENDING_LIMIT: 20 });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  async function fillPendingQueue(count) {
    const values = Array.from({ length: count }, (_, i) =>
      `('task-fill-${i}', 'hash-fill-${i.toString().padStart(64, '0')}', 'skill-${i}', 'pending')`
    ).join(',\n');

    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ${values}
    `);
  }

  it('pending = 19 时，新上传被接受（HTTP 201）', async () => {
    await fillPendingQueue(19);

    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test-skill')
      .field('platform', 'zenithjoy');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task_id');
  });

  it('pending = 20 时，新上传被拒绝（HTTP 429）', async () => {
    await fillPendingQueue(20);

    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test-skill')
      .field('platform', 'zenithjoy');

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('排队已满');
  });

  it('拒绝后数据库记录数不增加', async () => {
    await fillPendingQueue(20);

    const { cnt_before } = await db.one('SELECT COUNT(*) as cnt_before FROM skill_eval_tasks');

    const zip = makeValidZipBuffer();
    await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test-skill');

    const { cnt_after } = await db.one('SELECT COUNT(*) as cnt_after FROM skill_eval_tasks');
    expect(parseInt(cnt_after)).toBe(parseInt(cnt_before));
  });

  it('SKILL_EVAL_PENDING_LIMIT 可通过环境变量配置（设为 5 时，5 个 pending 即拒绝）', async () => {
    const smallApp = await createTestApp({ db, SKILL_EVAL_PENDING_LIMIT: 5 });
    await fillPendingQueue(5);

    const zip = makeValidZipBuffer();
    const res = await request(smallApp)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', process.env.SKILL_EVAL_PROXY_TOKEN || 'test-token')
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test-skill');

    expect(res.status).toBe(429);
  });
});
