import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 仅替换外部边界：真实提取、UPSERT、embedding 保存均执行。
const boundary = vi.hoisted(() => ({ query: vi.fn(), embedding: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: boundary.embedding }));
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
import { extractAndSaveUserFacts, _setApiKeyForTest, _resetApiKey } from '../user-profile.js';

let facts, rows, requests, failKey, nextId;
const localPool = { query: boundary.query };
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  rows = new Map();
  requests = [];
  failKey = null;
  nextId = 1;
  facts = { raw_facts: { 城市: '上海' }, display_name: '小明' };
  _setApiKeyForTest('isolated-fixture');
  vi.stubEnv('NOTION_API_KEY', 'isolated-fixture');
  vi.stubEnv('OPENAI_API_KEY', 'isolated-fixture');
  boundary.embedding.mockReset().mockResolvedValue([0.25, 0.75]);
  boundary.query.mockReset().mockImplementation(async (sql, args) => {
    if (sql.includes('INSERT INTO user_profiles')) return { rows: [{ user_id: args[0] }] };
    if (sql.includes('INSERT INTO user_profile_facts')) {
      expect(sql).toContain('ON CONFLICT (user_id, key) WHERE key IS NOT NULL');
      expect(sql).toContain('DO UPDATE SET content = EXCLUDED.content');
      const raw = sql.includes("'raw'");
      const [userId, content, key] = raw ? args : [args[0], args[2], args[3]];
      if (key === failKey) throw new Error('local write unavailable');
      const storageKey = `${userId}:${key}`;
      const row = rows.get(storageKey) || { id: nextId++, userId, key };
      row.content = content;
      rows.set(storageKey, row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('SET embedding')) {
      const row = [...rows.values()].find(r => r.id === args[1]);
      if (!row) throw new Error('embedding without saved fact');
      row.embedding = args[0];
      return { rows: [] };
    }
    if (sql.includes('SET notion_id')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    requests.push({ url, method: opts.method, body: JSON.parse(opts.body) });
    if (url === 'https://api.minimaxi.com/v1/chat/completions') {
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(facts) } }] }) };
    }
    // 修复前记录副本 POST；永不连接真实服务。
    if (url === 'https://api.notion.com/v1/pages') return { ok: true, json: async () => ({ id: 'record-only-page' }) };
    throw new Error(`Unexpected network boundary: ${url}`);
  }));
});

afterEach(() => {
  _resetApiKey();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function save(userId = 'owner') {
  await extractAndSaveUserFacts(localPool, userId, [{ role: 'user', content: '更新我的资料' }]);
  await settle();
}
function expectLocalOnlyRequests() {
  expect(requests.filter(r => r.url.startsWith('https://api.notion.com/'))).toEqual([]);
}

describe('聊天事实仅保留本地记忆', () => {
  it('新增原始与结构化事实后保存向量且不发送 Notion 副本', async () => {
    await save();
    expect(rows.get('owner:raw.城市')).toMatchObject({ content: '城市: 上海', embedding: '[0.25,0.75]' });
    expect(rows.get('owner:display_name')).toMatchObject({ content: '名字: 小明', embedding: '[0.25,0.75]' });
    expectLocalOnlyRequests();
  });
  it('重复事实按用户与 key 更新，保留 id 并刷新向量且不发送副本', async () => {
    await save();
    const originalId = rows.get('owner:raw.城市').id;
    facts = { raw_facts: { 城市: '杭州' }, display_name: '小王' };
    await save();
    expect(rows.size).toBe(2);
    expect(rows.get('owner:raw.城市')).toMatchObject({ id: originalId, content: '城市: 杭州', embedding: '[0.25,0.75]' });
    expect(rows.get('owner:display_name').content).toBe('名字: 小王');
    expectLocalOnlyRequests();
  });
  it('不同用户同 key 的事实与向量独立保留', async () => {
    await save('user-a');
    facts = { raw_facts: { 城市: '北京' } };
    await save('user-b');
    expect(rows.get('user-a:raw.城市')).toMatchObject({ userId: 'user-a', content: '城市: 上海', embedding: '[0.25,0.75]' });
    expect(rows.get('user-b:raw.城市')).toMatchObject({ userId: 'user-b', content: '城市: 北京', embedding: '[0.25,0.75]' });
    expect(rows.get('user-a:raw.城市').id).not.toBe(rows.get('user-b:raw.城市').id);
    expectLocalOnlyRequests();
  });
  it('向量生成失败仍保留本地事实且不发送副本', async () => {
    boundary.embedding.mockRejectedValue(new Error('isolated embedding outage'));
    await expect(save()).resolves.toBeUndefined();
    expect(rows.get('owner:raw.城市')).toMatchObject({ content: '城市: 上海' });
    expect(rows.get('owner:display_name')).toMatchObject({ content: '名字: 小明' });
    expect([...rows.values()].every(row => row.embedding === undefined)).toBe(true);
    expectLocalOnlyRequests();
  });
  it('单条本地事实失败不生成悬空向量，并继续保存结构化事实', async () => {
    failKey = 'raw.城市';
    await expect(save()).resolves.toBeUndefined();
    expect(rows.has('owner:raw.城市')).toBe(false);
    expect(rows.get('owner:display_name')).toMatchObject({ content: '名字: 小明', embedding: '[0.25,0.75]' });
    expect(boundary.embedding.mock.calls).toEqual([['名字: 小明']]);
    expectLocalOnlyRequests();
  });
});
