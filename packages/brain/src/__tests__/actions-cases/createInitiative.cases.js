import { describe, it, expect } from 'vitest';
import { mockQuery, createInitiative } from './fixture.js';

export function registerCreateInitiative() {
describe('createInitiative（已退役）', () => {
    it('name/parent_id 齐全时恒返回 layer_retired，不查询数据库', async () => {
      const result = await createInitiative({ name: '测试初始化', parent_id: 'proj-1' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('layer_retired');
      expect(result.decision).toBe('ee4842a6');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('缺少 name 返回失败（校验先于退役判断）', async () => {
      const result = await createInitiative({ parent_id: 'proj-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('缺少 parent_id 返回失败', async () => {
      const result = await createInitiative({ name: '无父级' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('parent_id');
    });
  });
}
