/**
 * /api/brain/time 三端点单元测试
 * - GET /iso       → ISO 8601 字符串
 * - GET /unix      → Unix 秒级整数时间戳
 * - GET /timezone  → IANA 时区字符串（可选 ?tz= 指定，非法 tz → 400）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../routes/time.js';

describe('/api/brain/time endpoints', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/brain/time', timeRouter);
  });

  describe('GET /iso', () => {
    it('returns HTTP 200 with a parseable ISO 8601 string', async () => {
      const resp = await request(app).get('/api/brain/time/iso').expect(200);
      expect(resp.body).toHaveProperty('iso');
      expect(typeof resp.body.iso).toBe('string');
      const parsed = new Date(resp.body.iso);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      // 字符串形态（宽松匹配：年-月-日T时:分:秒）
      expect(resp.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('GET /unix', () => {
    it('returns HTTP 200 with a positive integer seconds timestamp', async () => {
      const before = Math.floor(Date.now() / 1000);
      const resp = await request(app).get('/api/brain/time/unix').expect(200);
      const after = Math.floor(Date.now() / 1000);

      expect(resp.body).toHaveProperty('unix');
      expect(Number.isInteger(resp.body.unix)).toBe(true);
      expect(resp.body.unix).toBeGreaterThan(0);
      // 允许 ±2 秒漂移
      expect(resp.body.unix).toBeGreaterThanOrEqual(before - 2);
      expect(resp.body.unix).toBeLessThanOrEqual(after + 2);
    });
  });

  describe('GET /timezone', () => {
    it('returns HTTP 200 with a non-empty IANA timezone string (no tz param)', async () => {
      const resp = await request(app).get('/api/brain/time/timezone').expect(200);
      expect(resp.body).toHaveProperty('timezone');
      expect(typeof resp.body.timezone).toBe('string');
      expect(resp.body.timezone.length).toBeGreaterThan(0);
    });

    it('echoes back a valid IANA tz when provided via query', async () => {
      const resp = await request(app)
        .get('/api/brain/time/timezone')
        .query({ tz: 'Asia/Shanghai' })
        .expect(200);
      expect(resp.body.timezone).toBe('Asia/Shanghai');
    });

    it('returns HTTP 400 on invalid tz (Intl RangeError path)', async () => {
      const resp = await request(app)
        .get('/api/brain/time/timezone')
        .query({ tz: 'Mars/Olympus_Mons' })
        .expect(400);
      expect(resp.body).toHaveProperty('error');
      expect(String(resp.body.error).toLowerCase()).toContain('invalid timezone');
    });
  });
});
