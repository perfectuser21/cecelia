import { describe, it, expect } from 'vitest';
import { mockFetch, triggerN8n } from './fixture.js';

export function registerTriggerN8n() {
describe('triggerN8n', () => {
    it('正常触发 webhook（相对路径）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const result = await triggerN8n({
        webhook_path: 'test-hook',
        data: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.response).toBe('OK');

      // 检查 URL 拼接
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/webhook/test-hook');
    });

    it('正常触发 webhook（绝对 URL）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"result":"ok"}',
      });

      const result = await triggerN8n({
        webhook_path: 'http://custom:8080/hook',
        data: { foo: 'bar' },
      });

      expect(result.success).toBe(true);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('http://custom:8080/hook');
    });

    it('webhook 返回非 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Error',
      });

      const result = await triggerN8n({
        webhook_path: 'failing-hook',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
    });

    it('网络错误返回失败', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await triggerN8n({
        webhook_path: 'unreachable',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('data 为空时发送空对象', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      await triggerN8n({ webhook_path: 'empty' });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].body).toBe('{}');
    });
  });
}
