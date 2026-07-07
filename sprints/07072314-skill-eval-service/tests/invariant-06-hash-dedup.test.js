/**
 * INV-06: hash 去重
 * zip SHA-256 命中 completed → 直返历史 report_url
 * zip SHA-256 命中 in_progress/pending → 合流返回既有 task_id
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { makeValidZipBuffer } from './helpers/zip-factory.js';

const TOKEN = 'test-proxy-token';

describe('INV-06: hash 去重', () => {
  let app;
  let db;
  let zip;
  let zipHash;

  beforeEach(async () => {
    db = await createTestDb();
    app = await createTestApp({ db, SKILL_EVAL_PROXY_TOKEN: TOKEN });
    zip = makeValidZipBuffer();
    zipHash = createHash('sha256').update(zip).digest('hex');
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('命中 completed → HTTP 200，status: duplicate，返回历史 report_url', async () => {
    const existingReportUrl = 'https://hk-host/skill-evals/abc123-skill/report.html';

    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, report_url)
      VALUES ('existing-task', $1, 'existing-skill', 'completed', $2)
    `, [zipHash, existingReportUrl]);

    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'duplicate-skill');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');
    expect(res.body.report_url).toBe(existingReportUrl);
  });

  it('命中 completed → 数据库记录数不增加', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, report_url)
      VALUES ('existing-task', $1, 'existing-skill', 'completed', 'https://example.com/report.html')
    `, [zipHash]);

    const { before } = await db.one('SELECT COUNT(*) as before FROM skill_eval_tasks');

    await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'dup');

    const { after } = await db.one('SELECT COUNT(*) as after FROM skill_eval_tasks');
    expect(parseInt(after)).toBe(parseInt(before));
  });

  it('命中 in_progress → HTTP 200，status: merged，返回既有 task_id', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES ('running-task', $1, 'running-skill', 'running', NOW())
    `, [zipHash]);

    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'merged-skill');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');
    expect(res.body.task_id).toBe('running-task');
  });

  it('命中 pending → HTTP 200，status: merged，返回既有 task_id', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('pending-task', $1, 'pending-skill', 'pending')
    `, [zipHash]);

    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'merged-pending');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');
    expect(res.body.task_id).toBe('pending-task');
  });

  it('不同 zip（不同 hash）→ 正常建新 task（HTTP 201）', async () => {
    const otherZip = makeValidZipBuffer({ seed: 'different-content' });
    const otherHash = createHash('sha256').update(otherZip).digest('hex');
    expect(otherHash).not.toBe(zipHash);

    // 先存入一个 completed 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, report_url)
      VALUES ('other-task', $1, 'other', 'completed', 'https://example.com/other.html')
    `, [zipHash]);

    // 上传不同 zip
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', otherZip, { filename: 'other.zip', contentType: 'application/zip' })
      .field('skill_name', 'new-skill');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task_id');
  });
});
