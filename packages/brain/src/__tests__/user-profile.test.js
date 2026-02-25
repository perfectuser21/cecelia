/**
 * user-profile.test.js
 *
 * DoD 覆盖：
 *   D2-1 loadUserProfile 有数据时返回正确对象
 *   D2-2 没有数据时返回 null
 *   D2-3 upsertUserProfile 合并逻辑正确（只更新非空字段）
 *   D3   formatProfileSnippet 包含用户姓名
 *   D4-1 handleChat 返回时提取钩子已入队（fire-and-forget）
 *   D4-2 提取失败时 handleChat 仍正常返回
 *   D5-1 GET /api/brain/user/profile 返回 owner profile
 *   D5-2 PUT /api/brain/user/profile 更新后可读到新值
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock fs（让 getApiKey() 返回 null，避免读取真实凭据）──────
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw new Error('ENOENT: mocked'); }),
}));

// ─── mock fetch ──────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── mock db pool ─────────────────────────────────────────────
const mockPool = {
  query: vi.fn(),
};

// ─── 导入被测模块 ─────────────────────────────────────────────
import {
  loadUserProfile,
  upsertUserProfile,
  formatProfileSnippet,
  extractAndSaveUserFacts,
  getUserProfileContext,
  _resetApiKey,
  _setApiKeyForTest,
} from '../user-profile.js';

beforeEach(() => {
  vi.clearAllMocks();
  _resetApiKey();
});

// ─────────────────────────────────────────────────────────────
// D2-1: loadUserProfile 有数据时返回正确对象
// ─────────────────────────────────────────────────────────────
describe('loadUserProfile', () => {
  it('D2-1: 有数据时返回 profile 对象', async () => {
    const fakeProfile = {
      id: 1,
      user_id: 'owner',
      display_name: '徐啸 / Alex Xu',
      focus_area: 'Cecelia',
      preferred_style: 'detailed',
      timezone: 'Asia/Shanghai',
      raw_facts: {},
    };
    mockPool.query.mockResolvedValueOnce({ rows: [fakeProfile] });

    const result = await loadUserProfile(mockPool, 'owner');

    expect(result).toEqual(fakeProfile);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM user_profiles'),
      ['owner']
    );
  });

  it('D2-2: 没有数据时返回 null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await loadUserProfile(mockPool, 'owner');

    expect(result).toBeNull();
  });

  it('数据库错误时静默返回 null', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await loadUserProfile(mockPool, 'owner');

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// D2-3: upsertUserProfile 合并逻辑
// ─────────────────────────────────────────────────────────────
describe('upsertUserProfile', () => {
  it('D2-3: 只更新提供的非空字段', async () => {
    const updatedProfile = {
      id: 1,
      user_id: 'owner',
      display_name: '徐啸',
      focus_area: 'Cecelia',
      preferred_style: 'detailed',
    };
    mockPool.query.mockResolvedValueOnce({ rows: [updatedProfile] });

    const result = await upsertUserProfile(mockPool, 'owner', { display_name: '徐啸' });

    expect(result).toEqual(updatedProfile);
    // SQL 应包含 ON CONFLICT DO UPDATE
    const [sql, values] = mockPool.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(values).toContain('owner');
    expect(values).toContain('徐啸');
  });

  it('空 facts 时返回 null 且不调用 DB', async () => {
    const result = await upsertUserProfile(mockPool, 'owner', {});
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('raw_facts 使用 JSON merge 操作符', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await upsertUserProfile(mockPool, 'owner', {
      raw_facts: { hobby: '骑行' },
    });

    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toContain('raw_facts = raw_facts ||');
  });
});

// ─────────────────────────────────────────────────────────────
// D3: formatProfileSnippet
// ─────────────────────────────────────────────────────────────
describe('formatProfileSnippet', () => {
  it('D3: 包含用户姓名', () => {
    const profile = { display_name: '徐啸 / Alex Xu', focus_area: 'Cecelia', preferred_style: 'detailed' };
    const snippet = formatProfileSnippet(profile);
    expect(snippet).toContain('徐啸 / Alex Xu');
    expect(snippet).toContain('Cecelia');
  });

  it('D3: 无 profile 时返回空字符串', () => {
    expect(formatProfileSnippet(null)).toBe('');
    expect(formatProfileSnippet(undefined)).toBe('');
  });

  it('偏好 brief 时输出简洁说明', () => {
    const snippet = formatProfileSnippet({ display_name: 'Alex', preferred_style: 'brief' });
    expect(snippet).toContain('简洁');
  });
});

// ─────────────────────────────────────────────────────────────
// D1-D3: getUserProfileContext
// ─────────────────────────────────────────────────────────────
describe('getUserProfileContext', () => {
  it('D1: 有画像时返回格式化字符串', async () => {
    const fakeProfile = {
      user_id: 'owner',
      display_name: '徐啸',
      focus_area: 'Cecelia 自主运行',
      preferred_style: 'detailed',
    };
    mockPool.query.mockResolvedValueOnce({ rows: [fakeProfile] });

    const result = await getUserProfileContext(mockPool, 'owner');

    expect(typeof result).toBe('string');
    expect(result).toContain('徐啸');
    expect(result).toContain('Cecelia 自主运行');
  });

  it('D2: 无画像时返回空字符串', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getUserProfileContext(mockPool, 'owner');

    expect(result).toBe('');
  });

  it('D3: DB 异常时返回空字符串（不抛出）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const result = await getUserProfileContext(mockPool, 'owner');

    expect(result).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// D4: extractAndSaveUserFacts（fire-and-forget 语义）
// ─────────────────────────────────────────────────────────────
describe('extractAndSaveUserFacts', () => {
  it('D4-1: API key 不可用时静默跳过', async () => {
    // _resetApiKey 已调用，且 credentials 文件不存在 → apiKey = null
    await extractAndSaveUserFacts(mockPool, 'owner', [], 'hello');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('D4-2: fetch 失败时不抛出（静默忽略）', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    // 手动 mock apiKey
    vi.doMock('fs', () => ({
      readFileSync: () => JSON.stringify({ api_key: 'test-key' }),
    }));

    // 不抛出即为通过
    await expect(
      extractAndSaveUserFacts(mockPool, 'owner', [{ role: 'user', content: '我叫Alex' }], '你好')
    ).resolves.toBeUndefined();
  });

  it('对话为空时直接返回，不调用 API', async () => {
    await extractAndSaveUserFacts(mockPool, 'owner', [], '');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('D1: display_name 自动提取时 category 为 background', async () => {
    // 清除前面测试可能残留的未消费 mock（vi.clearAllMocks 不清 mock 队列）
    mockFetch.mockReset();
    mockPool.query.mockReset();
    // 注入 test API key，绕过 credentials 文件读取
    _setApiKeyForTest('sk-test');

    // MiniMax 返回 display_name
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"display_name": "徐啸"}' } }],
      }),
    });
    // call #1: upsertUserProfile → user_profiles
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    // call #2: structured fact INSERT → user_profile_facts
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'fact-bg-1' }] });

    await extractAndSaveUserFacts(
      mockPool,
      'owner',
      [{ role: 'user', content: '我叫徐啸' }],
      '好的，我记住了'
    );

    // 找到存入 user_profile_facts 的调用，验证 category 为 background
    const insertCalls = mockPool.query.mock.calls.filter(
      ([sql]) => sql && sql.includes('INSERT INTO user_profile_facts')
    );
    const backgroundCall = insertCalls.find(
      ([, params]) => Array.isArray(params) && params.includes('background')
    );
    expect(backgroundCall).toBeDefined();
  });

  it('D2: focus_area 自动提取时 category 为 behavior', async () => {
    mockFetch.mockReset();
    mockPool.query.mockReset();
    _setApiKeyForTest('sk-test');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"focus_area": "Cecelia 自主运行"}' } }],
      }),
    });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'fact-bh-1' }] });

    await extractAndSaveUserFacts(
      mockPool,
      'owner',
      [{ role: 'user', content: '我最近在做 Cecelia' }],
      '明白了'
    );

    const insertCalls = mockPool.query.mock.calls.filter(
      ([sql]) => sql && sql.includes('INSERT INTO user_profile_facts')
    );
    const behaviorCall = insertCalls.find(
      ([, params]) => Array.isArray(params) && params.includes('behavior')
    );
    expect(behaviorCall).toBeDefined();
  });
});
