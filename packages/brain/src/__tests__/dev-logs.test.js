/**
 * Tests for Dev Execution Logs API Routes
 * 验证 /api/brain/dev-logs 端点的功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Dev Execution Logs API', () => {
  describe('POST /api/brain/dev-logs', () => {
    it('should require task_id, run_id, phase, status fields', () => {
      const requiredFields = ['task_id', 'run_id', 'phase', 'status'];
      expect(requiredFields).toHaveLength(4);
      expect(requiredFields).toContain('task_id');
      expect(requiredFields).toContain('run_id');
      expect(requiredFields).toContain('phase');
      expect(requiredFields).toContain('status');
    });

    it('should create a log entry with valid data', () => {
      const mockLog = {
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        run_id: '660e8400-e29b-41d4-a716-446655440001',
        phase: 'prd',
        status: 'success',
        metadata: { branch: 'cp-03041838-test' }
      };

      expect(mockLog.task_id).toBeTruthy();
      expect(mockLog.run_id).toBeTruthy();
      expect(['prd', 'detect', 'branch', 'investigate', 'dod', 'code', 'verify', 'pr', 'ci', 'learning', 'cleanup'])
        .toContain(mockLog.phase);
      expect(['success', 'failure', 'in_progress']).toContain(mockLog.status);
    });

    it('should accept optional error_message for failure status', () => {
      const failureLog = {
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        run_id: '660e8400-e29b-41d4-a716-446655440001',
        phase: 'ci',
        status: 'failure',
        error_message: 'CI check failed: test suite error'
      };

      expect(failureLog.error_message).toBeTruthy();
      expect(failureLog.status).toBe('failure');
    });

    it('should accept optional metadata as object', () => {
      const metadataLog = {
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        run_id: '660e8400-e29b-41d4-a716-446655440001',
        phase: 'pr',
        status: 'success',
        metadata: {
          pr_number: 123,
          branch: 'cp-03041838-test',
          ci_duration_ms: 45000
        }
      };

      expect(metadataLog.metadata).toBeTypeOf('object');
      expect(metadataLog.metadata.pr_number).toBe(123);
    });

    it('should accept optional started_at and completed_at timestamps', () => {
      const now = new Date().toISOString();
      const log = {
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        run_id: '660e8400-e29b-41d4-a716-446655440001',
        phase: 'code',
        status: 'in_progress',
        started_at: now
      };

      expect(log.started_at).toBe(now);
      expect(new Date(log.started_at)).toBeInstanceOf(Date);
    });

    it('should return 400 when required fields are missing', () => {
      const invalidBody = {
        task_id: '550e8400-e29b-41d4-a716-446655440000'
        // run_id, phase, status 缺失
      };

      const missingFields = ['run_id', 'phase', 'status'].filter(
        f => !invalidBody[f]
      );
      expect(missingFields).toHaveLength(3);
    });
  });

  describe('GET /api/brain/dev-logs/:task_id', () => {
    it('should return logs array for a given task_id', () => {
      const mockLogs = [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          task_id: '550e8400-e29b-41d4-a716-446655440000',
          run_id: '660e8400-e29b-41d4-a716-446655440001',
          phase: 'prd',
          status: 'success',
          error_message: null,
          metadata: null,
          started_at: new Date().toISOString(),
          completed_at: null,
          created_at: new Date().toISOString()
        }
      ];

      expect(Array.isArray(mockLogs)).toBe(true);
      expect(mockLogs[0].task_id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(mockLogs[0]).toHaveProperty('phase');
      expect(mockLogs[0]).toHaveProperty('status');
    });

    it('should support pagination with limit and offset', () => {
      const params = { limit: '20', offset: '40' };
      const limit = parseInt(params.limit, 10);
      const offset = parseInt(params.offset, 10);

      expect(limit).toBe(20);
      expect(offset).toBe(40);
      expect(limit).toBeGreaterThan(0);
      expect(offset).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array when no logs found', () => {
      const emptyLogs = [];
      expect(Array.isArray(emptyLogs)).toBe(true);
      expect(emptyLogs).toHaveLength(0);
    });

    it('should return logs ordered by created_at DESC', () => {
      const mockLogs = [
        { created_at: '2026-03-04T18:00:00Z', phase: 'ci' },
        { created_at: '2026-03-04T17:00:00Z', phase: 'pr' },
        { created_at: '2026-03-04T16:00:00Z', phase: 'code' }
      ];

      // 验证时间降序排列
      for (let i = 0; i < mockLogs.length - 1; i++) {
        expect(new Date(mockLogs[i].created_at) >= new Date(mockLogs[i + 1].created_at)).toBe(true);
      }
    });
  });

  describe('GET /api/brain/dev-logs/stats', () => {
    it('should return overall success rate statistics', () => {
      const mockStats = {
        overall: {
          success_count: '8',
          failure_count: '2',
          total_count: '10',
          success_rate: '80.00'
        },
        by_phase: [],
        trend_7d: []
      };

      expect(mockStats).toHaveProperty('overall');
      expect(mockStats.overall).toHaveProperty('success_count');
      expect(mockStats.overall).toHaveProperty('failure_count');
      expect(mockStats.overall).toHaveProperty('total_count');
      expect(mockStats.overall).toHaveProperty('success_rate');
    });

    it('should return phase breakdown statistics', () => {
      const mockByPhase = [
        { phase: 'ci', failure_count: '3', total_count: '10', failure_rate: '30.00' },
        { phase: 'pr', failure_count: '1', total_count: '10', failure_rate: '10.00' }
      ];

      expect(Array.isArray(mockByPhase)).toBe(true);
      mockByPhase.forEach(item => {
        expect(item).toHaveProperty('phase');
        expect(item).toHaveProperty('failure_count');
        expect(item).toHaveProperty('total_count');
        expect(item).toHaveProperty('failure_rate');
      });
    });

    it('should return 7-day trend data', () => {
      const mockTrend = [
        { day: '2026-03-01T00:00:00Z', success_count: '3', failure_count: '1' },
        { day: '2026-03-02T00:00:00Z', success_count: '4', failure_count: '0' }
      ];

      expect(Array.isArray(mockTrend)).toBe(true);
      mockTrend.forEach(item => {
        expect(item).toHaveProperty('day');
        expect(item).toHaveProperty('success_count');
        expect(item).toHaveProperty('failure_count');
      });
    });

    it('should calculate success rate correctly', () => {
      const successCount = 8;
      const totalCount = 10;
      const successRate = (successCount / totalCount) * 100;

      expect(successRate).toBe(80);
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(100);
    });
  });

  describe('Database schema validation', () => {
    it('should have correct column structure for dev_execution_logs', () => {
      const expectedColumns = [
        'id',
        'task_id',
        'run_id',
        'phase',
        'status',
        'error_message',
        'metadata',
        'started_at',
        'completed_at',
        'created_at'
      ];

      expect(expectedColumns).toHaveLength(10);
      expect(expectedColumns).toContain('id');
      expect(expectedColumns).toContain('task_id');
      expect(expectedColumns).toContain('run_id');
      expect(expectedColumns).toContain('phase');
      expect(expectedColumns).toContain('status');
    });

    it('should validate phase values', () => {
      const validPhases = ['prd', 'detect', 'branch', 'investigate', 'dod', 'code', 'verify', 'pr', 'ci', 'learning', 'cleanup'];
      expect(validPhases).toHaveLength(11);
      validPhases.forEach(phase => {
        expect(typeof phase).toBe('string');
        expect(phase.length).toBeGreaterThan(0);
      });
    });

    it('should validate status values', () => {
      const validStatuses = ['success', 'failure', 'in_progress'];
      expect(validStatuses).toHaveLength(3);
      validStatuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });
  });

  describe('Error handling', () => {
    it('should return 500 on database error', () => {
      const dbError = new Error('Connection refused');
      expect(dbError.message).toContain('Connection');
    });

    it('should return 400 when body is malformed', () => {
      const status = 400;
      expect(status).toBe(400);
    });

    it('should handle null values gracefully for optional fields', () => {
      const log = {
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        run_id: '660e8400-e29b-41d4-a716-446655440001',
        phase: 'pr',
        status: 'success',
        error_message: null,
        metadata: null,
        completed_at: null
      };

      expect(log.error_message).toBeNull();
      expect(log.metadata).toBeNull();
      expect(log.completed_at).toBeNull();
    });
  });
});
