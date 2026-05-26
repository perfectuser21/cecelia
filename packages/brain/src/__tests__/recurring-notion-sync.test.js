import { describe, it, expect, vi } from 'vitest';
import { getToken, notionReq, RECURRING_TASKS_NOTION_DB_ID } from '../recurring-notion-sync.js';

describe('recurring-notion-sync — exports', () => {
  it('RECURRING_TASKS_NOTION_DB_ID 是非空字符串', () => {
    expect(typeof RECURRING_TASKS_NOTION_DB_ID).toBe('string');
    expect(RECURRING_TASKS_NOTION_DB_ID.length).toBeGreaterThan(0);
  });

  it('getToken 在无 NOTION_API_KEY 时抛出错误', () => {
    const orig = process.env.NOTION_API_KEY;
    delete process.env.NOTION_API_KEY;
    expect(() => getToken()).toThrow('NOTION_API_KEY');
    if (orig !== undefined) process.env.NOTION_API_KEY = orig;
  });

  it('getToken 在 NOTION_API_KEY 存在时返回 token', () => {
    process.env.NOTION_API_KEY = 'test-token-123';
    expect(getToken()).toBe('test-token-123');
    delete process.env.NOTION_API_KEY;
  });

  it('notionReq 是 function', () => {
    expect(typeof notionReq).toBe('function');
  });
});
