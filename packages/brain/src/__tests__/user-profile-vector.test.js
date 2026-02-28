/**
 * User Profile Vector Search Tests (migration 069)
 *
 * 覆盖：
 * - embedding-service: generateProfileFactEmbeddingAsync
 * - user-profile: getUserProfileContext 向量搜索路径
 * - user-profile: getUserProfileContext 降级路径
 * - user-profile: extractAndSaveUserFacts 写入 user_profile_facts
 * - migration 069 文件格式
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// 顶层共享 mock（只 mock db 和 openai-client，不 mock embedding-service）
// ============================================================

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

const mockGenerateEmbedding = vi.fn();
vi.mock('../openai-client.js', () => ({
  generateEmbedding: (...args) => mockGenerateEmbedding(...args),
}));

// ============================================================
// Tests: generateProfileFactEmbeddingAsync（直接测真实实现）
// ============================================================

describe('embedding-service: generateProfileFactEmbeddingAsync', () => {
  let generateProfileFactEmbeddingAsync;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const mod = await import('../embedding-service.js');
    generateProfileFactEmbeddingAsync = mod.generateProfileFactEmbeddingAsync;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('should generate and save profile fact embedding', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fakeEmbedding = Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
    mockPool.query.mockResolvedValue({ rows: [] });

    await generateProfileFactEmbeddingAsync('fact-uuid-1', '偏好简洁回答');

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('偏好简洁回答');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_profile_facts SET embedding'),
      expect.arrayContaining(['fact-uuid-1'])
    );
  });

  it('should no-op without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;

    await generateProfileFactEmbeddingAsync('fact-uuid-1', '偏好简洁回答');

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('should truncate text to 2000 chars', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const longText = 'a'.repeat(3000);
    mockGenerateEmbedding.mockResolvedValue(Array(1536).fill(0.1));
    mockPool.query.mockResolvedValue({ rows: [] });

    await generateProfileFactEmbeddingAsync('fact-uuid-1', longText);

    expect(mockGenerateEmbedding).toHaveBeenCalled();
    const calledText = mockGenerateEmbedding.mock.calls[0][0];
    expect(calledText.length).toBe(2000);
  });

  it('should silently fail on error', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockGenerateEmbedding.mockRejectedValue(new Error('API error'));
    mockPool.query.mockResolvedValue({ rows: [] });

    // 不抛异常
    await expect(generateProfileFactEmbeddingAsync('fact-uuid-1', 'test')).resolves.toBeUndefined();
  });
});

// ============================================================
// Tests: getUserProfileContext（向量搜索 + 降级）
// ============================================================

describe('user-profile: getUserProfileContext with vector search', () => {
  let getUserProfileContext;
  const mockProfileFactEmbed = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();
    mockProfileFactEmbed.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));
    vi.doMock('../embedding-service.js', () => ({
      generateProfileFactEmbeddingAsync: mockProfileFactEmbed,
      generateTaskEmbeddingAsync: vi.fn(),
      generateLearningEmbeddingAsync: vi.fn(),
    }));

    const mod = await import('../user-profile.js');
    getUserProfileContext = mod.getUserProfileContext;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('should use vector search when API key and conversationText provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockGenerateEmbedding.mockResolvedValue(Array(1536).fill(0.1));
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { content: '偏好简洁回答' },
        { content: '当前重点方向: Cecelia 开发' },
      ],
    });

    const result = await getUserProfileContext(mockPool, 'owner', '帮我看看代码');

    expect(mockGenerateEmbedding).toHaveBeenCalled();
    expect(result).toContain('偏好简洁回答');
    expect(result).toContain('当前重点方向: Cecelia 开发');
    expect(result).toContain('## 关于你');
  });

  it('should fallback to structured profile when no OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    // 新增 user_profile_facts 降级步骤：先查 facts（空），再查 user_profiles
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // user_profile_facts 降级（空）
      .mockResolvedValueOnce({             // loadUserProfile fallback
        rows: [{ display_name: '徐啸', focus_area: 'Cecelia', preferred_style: 'brief', raw_facts: {} }],
      });

    const result = await getUserProfileContext(mockPool, 'owner', '帮我看看代码');

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(result).toContain('徐啸');
  });

  it('should fallback to structured profile when no conversationText', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    // 新增 user_profile_facts 降级步骤：先查 facts（空），再查 user_profiles
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // user_profile_facts 降级（空）
      .mockResolvedValueOnce({             // loadUserProfile fallback
        rows: [{ display_name: '徐啸', focus_area: 'Cecelia', preferred_style: 'detailed', raw_facts: {} }],
      });

    const result = await getUserProfileContext(mockPool, 'owner');

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(result).toContain('徐啸');
  });

  it('should fallback when vector search returns no results', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockGenerateEmbedding.mockResolvedValue(Array(1536).fill(0.1));
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // vectorSearchProfileFacts DB query（空）
      .mockResolvedValueOnce({ rows: [] })  // user_profile_facts 降级（空）
      .mockResolvedValueOnce({             // loadUserProfile fallback
        rows: [{ display_name: '徐啸', focus_area: null, preferred_style: 'brief', raw_facts: {} }],
      });

    const result = await getUserProfileContext(mockPool, 'owner', '帮我看看代码');

    expect(result).toContain('徐啸');
  });

  it('should fallback when vector search throws', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    // vectorSearchProfileFacts 内部 catch 了 generateEmbedding 的错误，返回 []，不调用 pool.query
    mockGenerateEmbedding.mockRejectedValue(new Error('quota exceeded'));
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // user_profile_facts 降级（空）
      .mockResolvedValueOnce({             // loadUserProfile fallback
        rows: [{ display_name: '徐啸', focus_area: null, preferred_style: 'detailed', raw_facts: {} }],
      });

    const result = await getUserProfileContext(mockPool, 'owner', '帮我看看代码');

    expect(result).toContain('徐啸');
  });
});

// ============================================================
// Tests: extractAndSaveUserFacts → user_profile_facts
// ============================================================

describe('user-profile: extractAndSaveUserFacts writes to user_profile_facts', () => {
  const mockProfileFactEmbed = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockProfileFactEmbed.mockReset();
    global.fetch = vi.fn();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));
    vi.doMock('../embedding-service.js', () => ({
      generateProfileFactEmbeddingAsync: mockProfileFactEmbed,
      generateTaskEmbeddingAsync: vi.fn(),
      generateLearningEmbeddingAsync: vi.fn(),
    }));
  });

  it('should insert raw_facts entries into user_profile_facts', async () => {
    // Mock minimax credentials
    vi.doMock('fs', () => ({
      readFileSync: (p) => {
        if (String(p).includes('minimax.json')) {
          return JSON.stringify({ api_key: 'test-minimax-key' });
        }
        throw new Error('file not found');
      },
    }));
    vi.doMock('os', () => ({ homedir: () => '/home/test' }));
    vi.doMock('path', () => ({ join: (...args) => args.join('/') }));

    const mod = await import('../user-profile.js');
    mod._resetApiKey();

    // MiniMax response with raw_facts
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: '{"raw_facts": {"workspace": "美国 VPS"}}' }
        }],
      }),
    });

    // upsertUserProfile INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: 'owner' }] });
    // user_profile_facts INSERT
    mockPool.query.mockResolvedValue({ rows: [{ id: 'fact-uuid-1' }] });

    await mod.extractAndSaveUserFacts(mockPool, 'owner', [{ role: 'user', content: '我在美国 VPS 开发' }], '好的');

    // 验证 INSERT INTO user_profile_facts 被调用
    const insertCalls = mockPool.query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('user_profile_facts')
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Migration 069 validation
// ============================================================

describe('migration 069 validation', () => {
  it('should have correct migration file', () => {
    // 直接用 node:fs（带前缀的内置模块不受 vi.doMock('fs') 影响）
    // eslint-disable-next-line no-undef
    const { readFileSync: realReadFile } = require('fs');
    // import.meta.dirname 是测试文件所在目录 (brain/src/__tests__)
    const migrationPath = `${import.meta.dirname}/../../migrations/069_user_profile_facts_vector.sql`;
    const content = realReadFile(migrationPath, 'utf-8');

    expect(content).toContain('CREATE TABLE IF NOT EXISTS user_profile_facts');
    expect(content).toMatch(/embedding\s+vector\(1536\)/);
    expect(content).toContain("'069'");
    expect(content).toContain('hnsw');
  });
});
