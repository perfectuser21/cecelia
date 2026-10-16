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

describe('Notion请求固定域名与严格路径边界', () => {
  it.each([
    'https://evil.example/pages', '//evil.example/pages', '\\evil.example\\pages',
    '/pages/../../evil', '/pages/%2f%2fevil.example', '/pages/%5cevil',
    '/pages/page?redirect=https://evil.example', '/pages/page#evil',
    '/pages\n', '/pages/page\n', '/pages/page\r\n', '/pages/page\r',
    '/pages/page\u2028', '/pages/page\u2029', '/pages/page\0',
    { toString: () => '/pages' },
  ])('恶意或非字符串路径在发HTTP前拒绝：%j', async path => {
    const fetchImpl = vi.fn().mockResolvedValue(success());
    await expect(createNotionRequest({ token: 'test-only', fetchImpl })(path)).rejects.toMatchObject({ code: 'invalid_notion_path' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['/pages', '/pages/page-123', '/pages/page-123/markdown', '/blocks/block-123/children', '/data_sources/source-123', '/data_sources/source-123/query'])('合法路径仅能改变pathname且禁止重定向：%s', async path => {
    const fetchImpl = vi.fn().mockResolvedValue(success());
    await createNotionRequest({ token: 'test-only', fetchImpl })(path);
    const [target, options] = fetchImpl.mock.calls[0];
    expect(target).toBeInstanceOf(URL);
    const url = new URL(target);
    expect(url.origin).toBe('https://api.notion.com');
    expect(url.pathname).toBe(`/v1${path}`);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(options.redirect).toBe('error');
  });
});
