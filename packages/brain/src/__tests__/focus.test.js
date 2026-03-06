/**
 * Focus Engine 单元测试（mock pool，不需要真实数据库）
 *
 * 覆盖所有导出函数：
 *   getReadyKRs, selectDailyFocus, getDailyFocus,
 *   setDailyFocus, clearDailyFocus, getFocusSummary
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db 模块
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

import {
  getReadyKRs,
  selectDailyFocus,
  getDailyFocus,
  setDailyFocus,
  clearDailyFocus,
  getFocusSummary,
} from '../focus.js';

// ---------- 辅助数据 ----------

const makeKR = (id, parentId, priority = 'P0', status = 'ready') => ({
  id,
  title: `KR-${id}`,
  description: `desc-${id}`,
  priority,
  progress: 30,
  status,
  parent_id: parentId,
});

const makeObjective = (id, opts = {}) => ({
  id,
  title: opts.title || `OKR-${id}`,
  description: opts.description || `desc-${id}`,
  priority: opts.priority || 'P0',
  progress: opts.progress ?? 50,
  status: opts.status || 'in_progress',
  type: opts.type || 'vision',
});

// ---------- 测试 ----------

describe('focus', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ==================== getReadyKRs ====================

  describe('getReadyKRs', () => {
    it('返回所有 ready/in_progress 的 KR', async () => {
      const krs = [makeKR('kr-1', 'okr-1'), makeKR('kr-2', 'okr-1', 'P1', 'in_progress')];
      mockQuery.mockResolvedValueOnce({ rows: krs });

      const result = await getReadyKRs();

      expect(result).toEqual(krs);
      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      // 确认 SQL 包含正确的查询条件
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("type = 'area_okr'");
      expect(sql).toContain("'ready'");
      expect(sql).toContain("'in_progress'");
    });

    it('无 ready KR 时返回空数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getReadyKRs();

      expect(result).toEqual([]);
    });

    it('数据库异常时抛出错误', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(getReadyKRs()).rejects.toThrow('connection refused');
    });
  });

  // ==================== selectDailyFocus ====================

  describe('selectDailyFocus', () => {
    it('有手动覆盖时优先返回手动焦点', async () => {
      const objective = makeObjective('okr-manual', { type: 'mission' });

      // 1. 查 working_memory 手动覆盖
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { objective_id: 'okr-manual' } }],
      });
      // 2. 查 goals 表确认 objective 存在
      mockQuery.mockResolvedValueOnce({ rows: [objective] });

      const result = await selectDailyFocus();

      expect(result).toEqual({
        objective,
        reason: '手动设置的焦点',
        is_manual: true,
      });
    });

    it('手动覆盖的 objective 不存在时回退到自动选择', async () => {
      const kr = makeKR('kr-1', 'okr-auto');
      const objective = makeObjective('okr-auto');

      // 1. working_memory 有覆盖
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { objective_id: 'okr-deleted' } }],
      });
      // 2. 该 objective 不存在
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 3. getReadyKRs 查询
      mockQuery.mockResolvedValueOnce({ rows: [kr] });
      // 4. 查 area objective
      mockQuery.mockResolvedValueOnce({ rows: [objective] });

      const result = await selectDailyFocus();

      expect(result.is_manual).toBe(false);
      expect(result.objective.id).toBe('okr-auto');
    });

    it('无手动覆盖时自动选择 ready KR 最多的 Area', async () => {
      const krs = [
        makeKR('kr-1', 'okr-A'),
        makeKR('kr-2', 'okr-A'),
        makeKR('kr-3', 'okr-B'),
      ];
      const objectiveA = makeObjective('okr-A');

      // 1. working_memory 无覆盖
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: krs });
      // 3. 查 area 目标（okr-A 有 2 个 KR，最多）
      mockQuery.mockResolvedValueOnce({ rows: [objectiveA] });

      const result = await selectDailyFocus();

      expect(result.objective.id).toBe('okr-A');
      expect(result.reason).toBe('2 个 ready KR');
      expect(result.is_manual).toBe(false);
    });

    it('无 ready KR 时返回 null', async () => {
      // 1. working_memory 无覆盖
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs 返回空
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await selectDailyFocus();

      expect(result).toBeNull();
    });

    it('所有 KR 都没有 parent_id 时返回 null', async () => {
      const krs = [makeKR('kr-1', null), makeKR('kr-2', undefined)];

      // 1. working_memory 无覆盖
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: krs });

      const result = await selectDailyFocus();

      expect(result).toBeNull();
    });

    it('area 目标在 DB 中找不到时返回 null', async () => {
      const krs = [makeKR('kr-1', 'okr-ghost')];

      // 1. working_memory 无覆盖
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: krs });
      // 3. 查 area 目标不存在
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await selectDailyFocus();

      expect(result).toBeNull();
    });

    it('手动覆盖 value_json 无 objective_id 时回退到自动选择', async () => {
      const kr = makeKR('kr-1', 'okr-auto');
      const objective = makeObjective('okr-auto');

      // 1. working_memory 有记录但 value_json 无 objective_id
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { something_else: true } }],
      });
      // 2. getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: [kr] });
      // 3. 查 area 目标
      mockQuery.mockResolvedValueOnce({ rows: [objective] });

      const result = await selectDailyFocus();

      expect(result.is_manual).toBe(false);
    });
  });

  // ==================== getDailyFocus ====================

  describe('getDailyFocus', () => {
    it('返回完整的焦点信息（包含 KR 和推荐任务）', async () => {
      const objective = makeObjective('okr-1');
      const readyKRsUnderObj = [
        { id: 'kr-1', title: 'KR 1', progress: 30, weight: 1, status: 'ready' },
        { id: 'kr-2', title: 'KR 2', progress: 60, weight: 2, status: 'in_progress' },
      ];
      const tasks = [
        { id: 'task-1', title: 'Task 1', status: 'queued', priority: 'P0' },
      ];

      // selectDailyFocus 内部调用：
      // 1. working_memory 查询
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs（自动选择路径）
      mockQuery.mockResolvedValueOnce({
        rows: [makeKR('kr-1', 'okr-1'), makeKR('kr-2', 'okr-1')],
      });
      // 3. 查 area 目标
      mockQuery.mockResolvedValueOnce({ rows: [objective] });
      // getDailyFocus 自身的调用：
      // 4. 查该 objective 下的 ready KR
      mockQuery.mockResolvedValueOnce({ rows: readyKRsUnderObj });
      // 5. 查推荐任务
      mockQuery.mockResolvedValueOnce({ rows: tasks });

      const result = await getDailyFocus();

      expect(result).not.toBeNull();
      expect(result.focus.objective.id).toBe('okr-1');
      expect(result.focus.key_results).toEqual(readyKRsUnderObj);
      expect(result.focus.suggested_tasks).toEqual(tasks);
      expect(result.reason).toBe('2 个 ready KR');
      expect(result.is_manual).toBe(false);
    });

    it('selectDailyFocus 返回 null 时 getDailyFocus 也返回 null', async () => {
      // 1. working_memory 无覆盖
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2. getReadyKRs 返回空
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getDailyFocus();

      expect(result).toBeNull();
    });

    it('无 ready KR 下的任务时 suggested_tasks 为空数组', async () => {
      const objective = makeObjective('okr-1');

      // selectDailyFocus 路径
      mockQuery.mockResolvedValueOnce({ rows: [] }); // working_memory
      mockQuery.mockResolvedValueOnce({
        rows: [makeKR('kr-1', 'okr-1')],
      }); // getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: [objective] }); // area
      // getDailyFocus 路径
      mockQuery.mockResolvedValueOnce({ rows: [] }); // 该 objective 下无 ready KR
      // krIds 为空，不查任务

      const result = await getDailyFocus();

      expect(result.focus.key_results).toEqual([]);
      expect(result.focus.suggested_tasks).toEqual([]);
    });

    it('手动覆盖焦点时正确返回', async () => {
      const objective = makeObjective('okr-manual', { type: 'mission' });
      const krs = [{ id: 'kr-m', title: 'Manual KR', progress: 10, weight: 1, status: 'ready' }];
      const tasks = [{ id: 'task-m', title: 'Manual Task', status: 'queued', priority: 'P1' }];

      // selectDailyFocus: 手动覆盖路径
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { objective_id: 'okr-manual' } }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [objective] });
      // getDailyFocus 路径
      mockQuery.mockResolvedValueOnce({ rows: krs }); // ready KR
      mockQuery.mockResolvedValueOnce({ rows: tasks }); // tasks

      const result = await getDailyFocus();

      expect(result.is_manual).toBe(true);
      expect(result.reason).toBe('手动设置的焦点');
      expect(result.focus.objective.id).toBe('okr-manual');
      expect(result.focus.key_results).toEqual(krs);
      expect(result.focus.suggested_tasks).toEqual(tasks);
    });
  });

  // ==================== setDailyFocus ====================

  describe('setDailyFocus', () => {
    it('设置有效的 objective 成功', async () => {
      // 1. 确认 objective 存在
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'okr-1' }] });
      // 2. INSERT/UPDATE working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await setDailyFocus('okr-1');

      expect(result).toEqual({ success: true, objective_id: 'okr-1' });
      // 确认第二次 query 包含 UPSERT 逻辑
      const upsertSql = mockQuery.mock.calls[1][0];
      expect(upsertSql).toContain('INSERT INTO working_memory');
      expect(upsertSql).toContain('ON CONFLICT');
    });

    it('objective 不存在时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(setDailyFocus('okr-nonexistent'))
        .rejects.toThrow('Objective not found');
    });

    it('查询 objective 时只接受 mission/vision 类型', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'okr-1' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await setDailyFocus('okr-1');

      const selectParams = mockQuery.mock.calls[0][1];
      expect(selectParams).toContain('mission');
      expect(selectParams).toContain('vision');
    });

    it('数据库写入失败时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'okr-1' }] });
      mockQuery.mockRejectedValueOnce(new Error('DB write error'));

      await expect(setDailyFocus('okr-1')).rejects.toThrow('DB write error');
    });
  });

  // ==================== clearDailyFocus ====================

  describe('clearDailyFocus', () => {
    it('成功清除手动焦点', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await clearDailyFocus();

      expect(result).toEqual({ success: true });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('DELETE FROM working_memory');
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain('daily_focus_override');
    });

    it('无覆盖记录时也返回成功（幂等）', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await clearDailyFocus();

      expect(result).toEqual({ success: true });
    });

    it('数据库异常时抛出错误', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      await expect(clearDailyFocus()).rejects.toThrow('DB error');
    });
  });

  // ==================== getFocusSummary ====================

  describe('getFocusSummary', () => {
    it('返回焦点摘要（包含前 3 个 KR）', async () => {
      const objective = makeObjective('okr-1', { priority: 'P0', progress: 40 });
      const krs = [
        { id: 'kr-1', title: 'KR 1', progress: 20 },
        { id: 'kr-2', title: 'KR 2', progress: 60 },
      ];

      // selectDailyFocus 路径
      mockQuery.mockResolvedValueOnce({ rows: [] }); // working_memory
      mockQuery.mockResolvedValueOnce({
        rows: [makeKR('kr-1', 'okr-1'), makeKR('kr-2', 'okr-1')],
      }); // getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: [objective] }); // area
      // getFocusSummary 自身的 KR 查询
      mockQuery.mockResolvedValueOnce({ rows: krs });

      const result = await getFocusSummary();

      expect(result).not.toBeNull();
      expect(result.objective_id).toBe('okr-1');
      expect(result.objective_title).toBe('OKR-okr-1');
      expect(result.priority).toBe('P0');
      expect(result.progress).toBe(40);
      expect(result.key_results).toEqual(krs);
      expect(result.reason).toBe('2 个 ready KR');
      expect(result.is_manual).toBe(false);
    });

    it('selectDailyFocus 返回 null 时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getReadyKRs 空

      const result = await getFocusSummary();

      expect(result).toBeNull();
    });

    it('手动覆盖时返回正确摘要', async () => {
      const objective = makeObjective('okr-m', { type: 'mission', priority: 'P1' });
      const krs = [{ id: 'kr-m1', title: 'KR M1', progress: 80 }];

      // selectDailyFocus: 手动覆盖
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { objective_id: 'okr-m' } }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [objective] });
      // getFocusSummary 自身 KR 查询
      mockQuery.mockResolvedValueOnce({ rows: krs });

      const result = await getFocusSummary();

      expect(result.is_manual).toBe(true);
      expect(result.reason).toBe('手动设置的焦点');
      expect(result.priority).toBe('P1');
      expect(result.key_results).toEqual(krs);
    });

    it('KR 查询返回空时 key_results 为空数组', async () => {
      const objective = makeObjective('okr-1');

      mockQuery.mockResolvedValueOnce({ rows: [] }); // working_memory
      mockQuery.mockResolvedValueOnce({
        rows: [makeKR('kr-1', 'okr-1')],
      }); // getReadyKRs
      mockQuery.mockResolvedValueOnce({ rows: [objective] }); // area
      mockQuery.mockResolvedValueOnce({ rows: [] }); // KR 查询为空

      const result = await getFocusSummary();

      expect(result.key_results).toEqual([]);
    });
  });
});
