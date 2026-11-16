import { describe, it, expect, afterEach, vi } from 'vitest';
import { getToken } from '../recurring-notion-sync.js';

afterEach(() => vi.unstubAllEnvs());

describe('Notion请求凭据配置边界', () => {

  it('getToken 在无 NOTION_API_KEY 时抛出错误', () => {
    vi.stubEnv('NOTION_API_KEY', '');
    expect(() => getToken()).toThrow('NOTION_API_KEY');
  });

  it('getToken 在 NOTION_API_KEY 存在时返回 token', () => {
    vi.stubEnv('NOTION_API_KEY', 'test-token-123');
    expect(getToken()).toBe('test-token-123');
  });

});
