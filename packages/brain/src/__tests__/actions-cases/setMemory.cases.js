import { describe, it, expect } from 'vitest';
import { mockQuery, setMemory } from './fixture.js';

export function registerSetMemory() {
describe('setMemory', () => {
    it('正常设置内存', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await setMemory({
        key: 'test_key',
        value: { foo: 'bar' },
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('test_key');
      expect(result.value).toEqual({ foo: 'bar' });
    });

    it('SQL 使用 UPSERT (ON CONFLICT DO UPDATE)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await setMemory({ key: 'k', value: 'v' });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE');
    });

    it('传递正确的参数', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await setMemory({ key: 'my_key', value: 123 });

      const params = mockQuery.mock.calls[0][1];
      expect(params[0]).toBe('my_key');
      expect(params[1]).toBe(123);
    });
  });
}
