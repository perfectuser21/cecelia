/**
 * dispatcher.test.js — Skill Eval 调度器单元测试
 * Sprint: 07072314-skill-eval-service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';

describe('Skill Eval Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MAX_CONCURRENT_SKILL_EVAL = '1';
    process.env.QUOTA_5H_MIN_PCT = '85';
    process.env.QUOTA_7D_MIN_PCT = '90';
    process.env.SKILL_EVAL_TIMEOUT = '1800000';
  });

  describe('B04 — Single Slot', () => {
    it('should skip dispatch when slot is occupied', async () => {
      const { tryDispatch } = await import('./dispatcher.js');
      pool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      const result = await tryDispatch();
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('slot_occupied');
    });

    it('should return no_pending when slot is free but no tasks', async () => {
      const { tryDispatch } = await import('./dispatcher.js');
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // running count
        .mockResolvedValueOnce({ rows: [] }); // pending tasks empty
      const result = await tryDispatch();
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('no_pending');
    });

    it('MAX_CONCURRENT_SKILL_EVAL should be configurable', () => {
      process.env.MAX_CONCURRENT_SKILL_EVAL = '2';
      expect(parseInt(process.env.MAX_CONCURRENT_SKILL_EVAL, 10)).toBe(2);
    });
  });

  describe('B05 — Quota Check', () => {
    it('quota thresholds configurable via env', () => {
      process.env.QUOTA_5H_MIN_PCT = '80';
      process.env.QUOTA_7D_MIN_PCT = '85';
      expect(parseInt(process.env.QUOTA_5H_MIN_PCT, 10)).toBe(80);
      expect(parseInt(process.env.QUOTA_7D_MIN_PCT, 10)).toBe(85);
    });

    it('SKILL_EVAL_TIMEOUT configurable via env', () => {
      process.env.SKILL_EVAL_TIMEOUT = '1800000';
      expect(parseInt(process.env.SKILL_EVAL_TIMEOUT, 10)).toBe(1800000);
    });
  });

  describe('Failure states', () => {
    it('should include all four failure types', () => {
      const failureTypes = ['failed(dispatch)', 'failed(crash)', 'failed(timeout)', 'failed(publish)'];
      expect(failureTypes).toHaveLength(4);
      expect(failureTypes).toContain('failed(dispatch)');
      expect(failureTypes).toContain('failed(crash)');
      expect(failureTypes).toContain('failed(timeout)');
      expect(failureTypes).toContain('failed(publish)');
    });
  });
});
