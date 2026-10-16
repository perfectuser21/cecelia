import { describe, it, expect, vi } from 'vitest';
import { createNotionRequest } from './notion-sync.js';
const limited = () => ({ status: 429, ok: false, headers: new Headers({ 'retry-after': '0' }) });
const success = () => ({ status: 200, ok: true, json: async () => ({ object: 'list', results: [], has_more: false }) });
describe('Notion实际HTTP适配器的创建一次性边界', () => {
  it.each(['POST', 'post'])('创建页面即使429也只有一次物理POST，不隐藏三次重试 %s', async method => {
    const fetchImpl = vi.fn(async () => limited());
    const request = createNotionRequest({ token: 'test-only', fetchImpl });
    await expect(request('/pages', method, { parent: {}, properties: {} })).rejects.toMatchObject({ code: 'notion_http_429' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([['/data_sources/source', 'GET'], ['/data_sources/source/query', 'POST'], ['/pages/page', 'PATCH']])('只读或幂等请求保留429有界重试 %s %s', async (path, method) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(success());
    await createNotionRequest({ token: 'test-only', fetchImpl })(path, method, method === 'GET' ? undefined : {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
