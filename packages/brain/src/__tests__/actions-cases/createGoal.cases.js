import { describe, it, expect } from 'vitest';
import { mockQuery, createGoal } from './fixture.js';

export function registerCreateGoal() {
describe('createGoal', () => {
    it('正常创建目标（指定 type）', async () => {
      const fakeGoal = { id: 'goal-1', title: '目标', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await createGoal({
        title: '目标',
        type: 'area_okr',
      });

      expect(result.success).toBe(true);
      expect(result.goal).toEqual(fakeGoal);
    });

    it('无 type 无 parent 默认为 mission', async () => {
      const fakeGoal = { id: 'goal-okr', title: '顶级', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '顶级' });

      // mission → INSERT INTO visions, type 在 metadata 中
      const params = mockQuery.mock.calls[0][1];
      expect(JSON.parse(params[4]).type).toBe('mission');
    });

    it('有 parent_id 时自动推断 type（mission -> global_kr）', async () => {
      // 查询父级 type
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'mission' }] });
      // INSERT INTO objectives (global_kr)
      const fakeGoal = { id: 'goal-child', title: '子级', type: 'global_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '子级', parent_id: 'parent-1' });

      // objectives: params = [title, desc, priority, owner_role, parent_id, end_date, metaJson]
      const insertParams = mockQuery.mock.calls[1][1];
      expect(JSON.parse(insertParams[6]).type).toBe('global_kr');
    });

    it('有 parent_id 时自动推断 type（vision -> area_kr）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'vision' }] });
      const fakeGoal = { id: 'goal-akr', title: '区域KR', type: 'area_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '区域KR', parent_id: 'parent-2' });

      // key_results: params = [title, desc, priority, owner_role, parent_id, end_date, metaJson]
      const insertParams = mockQuery.mock.calls[1][1];
      expect(JSON.parse(insertParams[6]).type).toBe('area_kr');
    });

    it('有 parent_id 时自动推断 type（global_kr -> area_okr）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'global_kr' }] });
      const fakeGoal = { id: 'goal-aokr', title: '区域OKR', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '区域OKR', parent_id: 'parent-3' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(JSON.parse(insertParams[6]).type).toBe('area_okr');
    });

    it('有 parent_id 但父级类型未知时默认 area_okr', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'area_kr' }] });
      const fakeGoal = { id: 'goal-kr', title: '默认KR', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '默认KR', parent_id: 'parent-4' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(JSON.parse(insertParams[6]).type).toBe('area_okr');
    });

    it('有 parent_id 但父级不存在时抛出错误（parent 查询返回空）', async () => {
      // 父级查询返回空 - goalType 仍为 undefined → 新实现直接抛出错误，不再 fallback 到 goals 表
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(createGoal({ title: '孤儿', parent_id: 'parent-gone' }))
        .rejects.toThrow('unsupported goalType');
    });

    it('指定 type 优先于 parent 推断', async () => {
      const fakeGoal = { id: 'goal-explicit', title: '显式', type: 'global_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({
        title: '显式',
        parent_id: 'parent-5',
        type: 'global_kr',
      });

      // 不应该查询父级
      expect(mockQuery).toHaveBeenCalledTimes(1);
      // objectives: params = [title, desc, priority, owner_role, parent_id, end_date, metaJson]
      const insertParams = mockQuery.mock.calls[0][1];
      expect(JSON.parse(insertParams[6]).type).toBe('global_kr');
    });

    it('默认值：priority=P1, status=active（visions 用 active）', async () => {
      const fakeGoal = { id: 'goal-def', title: '默认', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '默认' });

      const sql = mockQuery.mock.calls[0][0];
      // visions 表用 'active'，不用 'pending'
      expect(sql).toContain("'active'");
    });

    it('传 domain 时 SQL 包含 metadata 字段，owner_role 自动推断', async () => {
      const fakeGoal = { id: 'goal-domain', title: 'quality目标', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({
        title: 'quality目标',
        domain: 'quality',
      });

      const sql = mockQuery.mock.calls[0][0];
      const params = mockQuery.mock.calls[0][1];
      // domain 存 metadata，owner_role 直接列
      expect(sql).toContain('owner_role');
      expect(sql).toContain('metadata');
      // visions: params = [title, desc, owner_role, end_date, metaJson]
      expect(params[2]).toBe('vp_qa'); // owner_role
      expect(JSON.parse(params[4]).domain).toBe('quality');
    });

    it('不传 domain 时 domain/owner_role 均为 null', async () => {
      const fakeGoal = { id: 'goal-nodomain', title: '无领域目标', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '无领域目标' });

      const sql = mockQuery.mock.calls[0][0];
      const allParams = mockQuery.mock.calls[0][1];
      // owner_role 为 null（直接列），domain 在 metadata 中为 null
      expect(sql).toContain('metadata');
      expect(allParams[2]).toBeNull(); // owner_role
      expect(JSON.parse(allParams[4]).domain).toBeNull();
    });
  });
}
