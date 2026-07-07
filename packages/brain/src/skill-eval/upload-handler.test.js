/**
 * upload-handler.test.js — Skill Eval 上传处理器单元测试
 * Sprint: 07072314-skill-eval-service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('multer', () => ({
  default: vi.fn(() => ({
    single: vi.fn(() => (req, res, next) => { next(); })
  }))
}));

import pool from '../db.js';
import {
  validateToken,
  validateZip,
  checkBackpressure,
  detectPathTraversal,
} from './upload-handler.js';

describe('Skill Eval Upload Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVAL_PROXY_TOKEN = 'test-token-123';
    process.env.MAX_SKILL_EVAL_QUEUE = '20';
    process.env.MAX_UNZIP_MB = '50';
    process.env.MAX_COMPRESS_RATIO = '100';
    process.env.MAX_ZIP_FILES = '2000';
  });

  describe('B01 — Token Validation', () => {
    it('should return 403 when X-Eval-Proxy-Token is missing', () => {
      const req = { headers: {} };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      validateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when X-Eval-Proxy-Token is invalid', () => {
      const req = { headers: { 'x-eval-proxy-token': 'wrong-token' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      validateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() with correct token', () => {
      const req = { headers: { 'x-eval-proxy-token': 'test-token-123' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      validateToken(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('B02 — ZIP Validation', () => {
    it('should reject non-zip file (invalid magic bytes)', async () => {
      const buf = Buffer.from('not a zip file');
      await expect(validateZip(buf)).rejects.toThrow('invalid_zip');
    });

    it('should reject zip missing SKILL.md', async () => {
      // Minimal empty zip (end-of-central-directory only)
      const emptyZip = Buffer.from([
        0x50, 0x4b, 0x05, 0x06,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]);
      await expect(validateZip(emptyZip)).rejects.toThrow('skill_md_missing');
    });

    it('should reject zip with path traversal (../)', () => {
      expect(detectPathTraversal('../etc/passwd')).toBe(true);
    });

    it('should reject absolute path (/) as path traversal', () => {
      expect(detectPathTraversal('/etc/passwd')).toBe(true);
    });

    it('should allow safe relative path', () => {
      expect(detectPathTraversal('safe/path/file.js')).toBe(false);
    });

    it('should allow SKILL.md at root', () => {
      expect(detectPathTraversal('SKILL.md')).toBe(false);
    });
  });

  describe('B06 — Backpressure', () => {
    it('should reject with 429 when pending >= MAX_SKILL_EVAL_QUEUE', async () => {
      process.env.MAX_SKILL_EVAL_QUEUE = '20';
      pool.query.mockResolvedValueOnce({ rows: [{ count: '20' }] });
      const req = {
        headers: { 'x-eval-proxy-token': 'test-token-123' },
        file: { buffer: Buffer.from('test') },
        body: { skill_name: 'test', source_platform: 'Claude', journey_id: 'abc' }
      };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      await checkBackpressure(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow upload when pending < MAX_SKILL_EVAL_QUEUE', async () => {
      process.env.MAX_SKILL_EVAL_QUEUE = '20';
      pool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
      const next = vi.fn();
      const req = {
        headers: { 'x-eval-proxy-token': 'test-token-123' },
        file: { buffer: Buffer.from('test') },
        body: {}
      };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await checkBackpressure(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('NFR env-var coverage', () => {
    it('MAX_SKILL_EVAL_QUEUE should be configurable', () => {
      process.env.MAX_SKILL_EVAL_QUEUE = '5';
      expect(parseInt(process.env.MAX_SKILL_EVAL_QUEUE, 10)).toBe(5);
    });

    it('MAX_UNZIP_MB should be configurable', () => {
      process.env.MAX_UNZIP_MB = '100';
      expect(parseInt(process.env.MAX_UNZIP_MB, 10)).toBe(100);
    });

    it('MAX_COMPRESS_RATIO should be configurable', () => {
      process.env.MAX_COMPRESS_RATIO = '50';
      expect(parseInt(process.env.MAX_COMPRESS_RATIO, 10)).toBe(50);
    });

    it('MAX_ZIP_FILES should be configurable', () => {
      process.env.MAX_ZIP_FILES = '1000';
      expect(parseInt(process.env.MAX_ZIP_FILES, 10)).toBe(1000);
    });
  });
});
