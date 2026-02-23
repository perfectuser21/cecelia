/**
 * dept-heartbeat-task-type.test.js
 *
 * 验证 dept_heartbeat task_type 约束修复（migration 070）
 *
 * 测试策略：
 * - 直接测试 dept-heartbeat.js 的逻辑（mock pool）
 * - 验证 createDeptHeartbeatTask 构造的 SQL 使用 dept_heartbeat task_type
 * - 验证 getEnabledDepts 查询逻辑正确
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeptHeartbeatTask, getEnabledDepts, triggerDeptHeartbeats } from '../dept-heartbeat.js';

describe('dept-heartbeat task_type constraint (migration 070)', () => {
  let capturedSQL;
  let capturedParams;
  let mockPool;

  beforeEach(() => {
    capturedSQL = [];
    capturedParams = [];

    mockPool = {
      query: vi.fn(async (sql, params) => {
        capturedSQL.push(sql.trim());
        capturedParams.push(params || []);

        // getEnabledDepts → return one dept
        if (sql.includes('FROM dept_configs')) {
          return { rows: [{ dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/home/xx/perfect21/zenithjoy' }] };
        }

        // createDeptHeartbeatTask — check existing → none
        if (sql.includes('status IN') && sql.includes('dept_heartbeat')) {
          return { rows: [] };
        }

        // INSERT → return new task id
        if (sql.includes('INSERT INTO tasks')) {
          return { rows: [{ id: 'test-heartbeat-task-id' }] };
        }

        return { rows: [] };
      }),
    };
  });

  describe('createDeptHeartbeatTask', () => {
    it('should use dept_heartbeat as task_type in INSERT', async () => {
      const dept = { dept_name: 'zenithjoy', repo_path: '/home/xx/perfect21/zenithjoy', max_llm_slots: 2 };
      const result = await createDeptHeartbeatTask(mockPool, dept);

      expect(result.created).toBe(true);
      expect(result.task_id).toBe('test-heartbeat-task-id');

      // 找到 INSERT INTO tasks 的 SQL
      const insertSQL = capturedSQL.find(sql => sql.includes('INSERT INTO tasks'));
      expect(insertSQL).toBeDefined();
      expect(insertSQL).toContain("'dept_heartbeat'");
    });

    it('should check for existing dept_heartbeat tasks before inserting', async () => {
      const dept = { dept_name: 'zenithjoy', repo_path: '/tmp/test', max_llm_slots: 2 };
      await createDeptHeartbeatTask(mockPool, dept);

      const checkSQL = capturedSQL.find(sql => sql.includes('dept_heartbeat') && sql.includes('status IN'));
      expect(checkSQL).toBeDefined();
      expect(checkSQL).toContain("'queued'");
      expect(checkSQL).toContain("'in_progress'");
    });

    it('should skip creation if active heartbeat already exists', async () => {
      mockPool.query.mockImplementation(async (sql) => {
        if (sql.includes('status IN') && sql.includes('dept_heartbeat')) {
          return { rows: [{ id: 'existing-task-id' }] };
        }
        return { rows: [] };
      });

      const dept = { dept_name: 'zenithjoy', repo_path: '/tmp/test', max_llm_slots: 2 };
      const result = await createDeptHeartbeatTask(mockPool, dept);

      expect(result.created).toBe(false);
      expect(result.reason).toBe('already_active');
      expect(result.task_id).toBe('existing-task-id');

      // INSERT 不应该被调用
      const insertSQL = capturedSQL.find(sql => sql.includes('INSERT INTO tasks'));
      expect(insertSQL).toBeUndefined();
    });

    it('should include dept_name and repo_path in task payload', async () => {
      const dept = { dept_name: 'zenithjoy', repo_path: '/home/xx/perfect21/zenithjoy', max_llm_slots: 2 };
      await createDeptHeartbeatTask(mockPool, dept);

      const insertIdx = capturedSQL.findIndex(sql => sql.includes('INSERT INTO tasks'));
      expect(insertIdx).toBeGreaterThanOrEqual(0);

      const insertParams = capturedParams[insertIdx];
      const payload = JSON.parse(insertParams[2]);
      expect(payload.dept_name).toBe('zenithjoy');
      expect(payload.repo_path).toBe('/home/xx/perfect21/zenithjoy');
      expect(payload.max_llm_slots).toBe(2);
    });
  });

  describe('getEnabledDepts', () => {
    it('should query dept_configs where enabled=true', async () => {
      const depts = await getEnabledDepts(mockPool);

      expect(depts).toHaveLength(1);
      expect(depts[0].dept_name).toBe('zenithjoy');

      const sql = capturedSQL.find(s => s.includes('dept_configs'));
      expect(sql).toBeDefined();
      expect(sql).toContain('enabled = true');
    });
  });

  describe('triggerDeptHeartbeats', () => {
    it('should trigger heartbeat for enabled depts', async () => {
      const result = await triggerDeptHeartbeats(mockPool);

      expect(result.triggered).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].dept).toBe('zenithjoy');
      expect(result.results[0].created).toBe(true);
    });

    it('should handle DB errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await triggerDeptHeartbeats(mockPool);

      // 应该不 throw，返回 triggered=0
      expect(result.triggered).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });
});
