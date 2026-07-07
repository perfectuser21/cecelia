/**
 * publisher.test.js — Skill Eval 发布器单元测试
 * Sprint: 07072314-skill-eval-service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('node-ssh', () => ({
  NodeSSH: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    putDirectory: vi.fn().mockResolvedValue({ successfulTransfers: [], failedTransfers: [] }),
    execCommand: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
    dispose: vi.fn(),
  }))
}));

import pool from '../db.js';

describe('Skill Eval Publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HK_SSH_HOST = 'hk-vps';
    process.env.HK_SSH_USER = 'root';
    process.env.HK_DOCS_PATH = '/data/docs/skill-evals';
  });

  describe('B07 — evals Table Write', () => {
    it('should write evals row on completion', async () => {
      const { writeEvalsRow } = await import('./publisher.js');
      pool.query.mockResolvedValueOnce({ rows: [] });
      await writeEvalsRow({
        taskId: 'test-task-id',
        skillName: 'test-skill',
        status: 'completed',
        reportUrl: 'https://example.com/report',
        durationMs: 1000
      });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO evals'),
        expect.arrayContaining(['test-task-id', 'test-skill', 'completed'])
      );
    });

    it('should write evals row on failure', async () => {
      const { writeEvalsRow } = await import('./publisher.js');
      pool.query.mockResolvedValueOnce({ rows: [] });
      await writeEvalsRow({
        taskId: 'test-task-id',
        skillName: 'test-skill',
        status: 'failed(publish)',
        reportUrl: null,
        durationMs: 500
      });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO evals'),
        expect.arrayContaining(['failed(publish)'])
      );
    });
  });

  describe('SSH target config', () => {
    it('should not hardcode SSH host (must use env var)', async () => {
      const { getPublishConfig } = await import('./publisher.js');
      const config = getPublishConfig();
      expect(config.host).toBe(process.env.HK_SSH_HOST);
    });
  });
});
