/**
 * INV-04: 硬校验五件套
 * zip 魔数 / 解压 ≤ 50MB / 压缩比 ≤ 100:1 / 文件数 ≤ 2000 / 唯一 SKILL.md / 无路径穿越
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import {
  makeValidZipBuffer,
  makeZipWithBadMagic,
  makeZipWithNoSkillMd,
  makeZipWithMultipleSkillMd,
  makeZipWithPathTraversal,
  makeZipExceedingFileCount,
} from './helpers/zip-factory.js';

const TOKEN = 'test-proxy-token';

describe('INV-04: 硬校验五件套', () => {
  let app;
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    app = await createTestApp({
      db,
      MAX_ZIP_MB: 10,
      SKILL_EVAL_PROXY_TOKEN: TOKEN,
    });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('合法 zip → 通过校验（HTTP 201）', async () => {
    const zip = makeValidZipBuffer();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'valid-skill');

    expect(res.status).toBe(201);
  });

  it('zip 魔数错误 → HTTP 400', async () => {
    const badZip = makeZipWithBadMagic();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', badZip, { filename: 'bad.zip', contentType: 'application/zip' })
      .field('skill_name', 'bad-skill');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/magic|zip|format/i);
  });

  it('缺少 SKILL.md → HTTP 400', async () => {
    const zip = makeZipWithNoSkillMd();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'no-skill-md.zip', contentType: 'application/zip' })
      .field('skill_name', 'no-md');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SKILL\.md/);
  });

  it('多个 SKILL.md → HTTP 400', async () => {
    const zip = makeZipWithMultipleSkillMd();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'multi-md.zip', contentType: 'application/zip' })
      .field('skill_name', 'multi-md');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SKILL\.md/);
  });

  it('路径穿越攻击 → HTTP 400', async () => {
    const zip = makeZipWithPathTraversal();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'traversal.zip', contentType: 'application/zip' })
      .field('skill_name', 'traversal');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traversal|path/i);
  });

  it('超过文件数 2000 → HTTP 400', async () => {
    const zip = makeZipExceedingFileCount(2001);
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', zip, { filename: 'too-many.zip', contentType: 'application/zip' })
      .field('skill_name', 'too-many');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file.*(count|limit|2000)/i);
  });

  it('错误信息应具体描述失败原因', async () => {
    const badZip = makeZipWithBadMagic();
    const res = await request(app)
      .post('/api/brain/skill-evals/upload')
      .set('X-Eval-Proxy-Token', TOKEN)
      .attach('file', badZip, { filename: 'bad.zip', contentType: 'application/zip' })
      .field('skill_name', 'bad');

    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(5);
  });
});
