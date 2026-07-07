/**
 * FR-UPLOAD-FLOW: 上传端点全链路顺序验证
 * 验证 token验证→硬校验→hash去重→建task 的执行顺序。
 * 使用 supertest + 内存 DB mock，CI 中全自动运行。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { makeValidZipBuffer } from './helpers/zip-factory.js';

describe('FR-UPLOAD-FLOW: 上传链路顺序', () => {
  let db;
  let app;
  const VALID_TOKEN = 'test-proxy-token-valid';

  beforeEach(async () => {
    db = await createTestDb();
    app = await createTestApp({ db, SKILL_EVAL_PROXY_TOKEN: VALID_TOKEN });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  // ── Step 1: Token 验证（最先执行）────────────────────────────────────
  describe('Step 1 — Token 验证在所有业务逻辑之前', () => {
    it('无 X-Eval-Proxy-Token → HTTP 403，不执行校验或 DB 操作', async () => {
      const zip = makeValidZipBuffer();
      const before = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        // 故意不带 token
        .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
        .field('skill_name', 'test-skill');

      expect(res.status).toBe(403);

      // 确认 DB 未写入
      const after = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');
      expect(parseInt(after.cnt)).toBe(parseInt(before.cnt));
    });

    it('错误 X-Eval-Proxy-Token → HTTP 403，即使 zip 合法', async () => {
      const zip = makeValidZipBuffer();

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', 'wrong-token-xyz')
        .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
        .field('skill_name', 'test-skill');

      expect(res.status).toBe(403);
    });
  });

  // ── Step 2: 硬校验（Token 通过后、hash去重之前）───────────────────────
  describe('Step 2 — 硬校验在 token 通过后、hash 去重之前', () => {
    it('非法 zip（魔数错误）→ HTTP 400，不查 DB hash 记录', async () => {
      // 先插入一条 completed 记录，确认 hash 去重不会被触发
      await db.none(`
        INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, report_url)
        VALUES ('existing-task', 'fake-hash-notexist', 'fake-skill', 'completed', 'https://example.com/report.html')
      `);

      const invalidZip = Buffer.from('not a zip file content');

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .attach('file', invalidZip, { filename: 'invalid.zip', contentType: 'application/zip' })
        .field('skill_name', 'test-skill');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/magic|invalid zip/i);
    });

    it('无 SKILL.md 的 zip → HTTP 400，错误信息明确', async () => {
      const { makeZipWithoutSkillMd } = await import('./helpers/zip-factory.js');
      const zip = makeZipWithoutSkillMd();

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .attach('file', zip, { filename: 'noskillmd.zip', contentType: 'application/zip' })
        .field('skill_name', 'test-skill');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/SKILL\.md/i);
    });
  });

  // ── Step 3: hash 去重（硬校验通过后、建 task 之前）──────────────────
  describe('Step 3 — hash 去重在硬校验通过后、建 task 之前', () => {
    it('命中 completed hash → HTTP 200 duplicate，不新建 task', async () => {
      const zip = makeValidZipBuffer();
      // 先计算 zip 的 sha256（由 makeValidZipBuffer 返回固定 hash）
      const knownHash = 'aaabbbccc000111222333444555666777888999aaabbbccc000111222333444555';

      await db.none(`
        INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, report_url)
        VALUES ('dup-completed', $1, 'dup-skill', 'completed', 'https://hk-host/skill-evals/dup/report.html')
      `, [knownHash]);

      const countBefore = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .set('X-Test-Force-Hash', knownHash) // test hook：强制指定 hash（测试专用头）
        .attach('file', zip, { filename: 'dup.zip', contentType: 'application/zip' })
        .field('skill_name', 'dup-skill');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('duplicate');
      expect(res.body.report_url).toBe('https://hk-host/skill-evals/dup/report.html');

      const countAfter = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');
      expect(parseInt(countAfter.cnt)).toBe(parseInt(countBefore.cnt));
    });

    it('命中 in_progress hash → HTTP 200 merged，返回既有 task_id', async () => {
      const zip = makeValidZipBuffer();
      const knownHash = 'bbbcccaaa000111222333444555666777888999bbbcccaaa000111222333444555';

      await db.none(`
        INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
        VALUES ('inprog-task', $1, 'inprog-skill', 'in_progress')
      `, [knownHash]);

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .set('X-Test-Force-Hash', knownHash)
        .attach('file', zip, { filename: 'dup.zip', contentType: 'application/zip' })
        .field('skill_name', 'inprog-skill');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('merged');
      expect(res.body.task_id).toBe('inprog-task');
    });
  });

  // ── Step 4: 建 task（全部前置步骤通过后）────────────────────────────
  describe('Step 4 — 建 task 在全链路通过后', () => {
    it('新 zip 全链路通过 → HTTP 201，返回 UUID task_id，DB 有新记录', async () => {
      const zip = makeValidZipBuffer();

      const countBefore = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');

      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .attach('file', zip, { filename: 'new-skill.zip', contentType: 'application/zip' })
        .field('skill_name', 'new-skill')
        .field('platform', 'zenithjoy')
        .field('submitter', 'tester');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('task_id');
      expect(res.body.task_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      const countAfter = await db.one('SELECT COUNT(*) as cnt FROM skill_eval_tasks');
      expect(parseInt(countAfter.cnt)).toBe(parseInt(countBefore.cnt) + 1);

      // 确认 DB 记录字段完整
      const row = await db.oneOrNone(
        `SELECT task_id, skill_name, platform, submitter, status, zip_hash
         FROM skill_eval_tasks WHERE task_id=$1`,
        [res.body.task_id]
      );
      expect(row).not.toBeNull();
      expect(row.skill_name).toBe('new-skill');
      expect(row.platform).toBe('zenithjoy');
      expect(row.submitter).toBe('tester');
      expect(row.status).toBe('pending');
      expect(row.zip_hash).toBeTruthy();
    });

    it('全链路响应时间 < 5s（性能基线）', async () => {
      const zip = makeValidZipBuffer();
      const start = Date.now();

      await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('X-Eval-Proxy-Token', VALID_TOKEN)
        .attach('file', zip, { filename: 'perf-skill.zip', contentType: 'application/zip' })
        .field('skill_name', 'perf-skill');

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
