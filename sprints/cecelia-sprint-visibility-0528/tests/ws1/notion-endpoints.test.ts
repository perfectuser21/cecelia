import { describe, it, expect } from 'vitest';

const BRAIN_URL = 'http://localhost:5221';

describe('Workstream 1 — Brain Notion API 端点 [BEHAVIOR]', () => {
  it('POST /api/brain/notes 端点已注册（非 404）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ws1-test', content: 'test content', type: 'Note' }),
    });
    // 404 = 路由未注册 = WS 未实现 → FAIL
    expect([201, 400, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notes 成功时返回 schema {id, url, title}，keys 完全等于 ["id","title","url"]，无禁用字段', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'schema-test', content: 'c', type: 'Note' }),
    });
    if (resp.status === 201) {
      const data = await resp.json();
      expect(typeof data.id).toBe('string');
      expect(typeof data.url).toBe('string');
      expect(typeof data.title).toBe('string');
      // keys completeness oracle
      expect(Object.keys(data).sort()).toEqual(['id', 'title', 'url']);
      expect('page_id' in data).toBe(false);
      expect('notion_id' in data).toBe(false);
      expect('result' in data).toBe(false);
      expect('data' in data).toBe(false);
      expect('payload' in data).toBe(false);
    }
    expect([201, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notes 缺 title 返回 400 + {error: string}', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'c', type: 'Note' }),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(typeof data.error).toBe('string');
  });

  it('POST /api/brain/notes 缺 content 返回 400 + {error: string}', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't', type: 'Note' }),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(typeof data.error).toBe('string');
  });

  it('POST /api/brain/notion/project 端点已注册（非 404）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notion/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'MyRun' }),
    });
    expect([201, 400, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notion/project 成功时 title 精确等于 "[Sprint] MyRun"（原始 title 保留）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notion/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'MyRun' }),
    });
    if (resp.status === 201) {
      const data = await resp.json();
      // Round 3 Fix — 精确等值验证，防 generator 只返回 "[Sprint]" 漏掉原始 title
      expect(data.title).toBe('[Sprint] MyRun');
      expect(Object.keys(data).sort()).toEqual(['id', 'title', 'url']);
      expect('page_id' in data).toBe(false);
      expect('notion_id' in data).toBe(false);
    }
    expect([201, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notion/task 端点已注册（非 404）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notion/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '实现功能X', ws_number: 2 }),
    });
    expect([201, 400, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notion/task 成功时 title 精确等于 "[WS2] 实现功能X"（ws_number=2 精确匹配，原始 title 保留），keys 完全等于 ["id","title","url"]', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notion/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '实现功能X', ws_number: 2 }),
    });
    if (resp.status === 201) {
      const data = await resp.json();
      expect(typeof data.id).toBe('string');
      expect(typeof data.url).toBe('string');
      // Round 3 Fix — 精确匹配 [WS2]（不是宽松的 /^\[WS\d+\]/），防 generator 返回 [WSnone]
      expect(data.title).toBe('[WS2] 实现功能X');
      // keys completeness oracle
      expect(Object.keys(data).sort()).toEqual(['id', 'title', 'url']);
      expect('page_id' in data).toBe(false);
      expect('notion_id' in data).toBe(false);
    }
    expect([201, 502]).toContain(resp.status);
  });

  it('POST /api/brain/notion/project 成功时 response keys 完全等于 ["id","title","url"]', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/notion/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'KeysTest' }),
    });
    if (resp.status === 201) {
      const data = await resp.json();
      expect(Object.keys(data).sort()).toEqual(['id', 'title', 'url']);
    }
    expect([201, 502]).toContain(resp.status);
  });
});
