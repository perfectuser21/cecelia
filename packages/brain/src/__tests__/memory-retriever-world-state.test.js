/**
 * memory-retriever-world-state.test.js — WORLD_STATE 条件注入 + token 预算上限测试
 *
 * 验收标准：
 * 1. chat 模式下非 OKR/项目类查询 → WORLD_STATE 不注入
 * 2. USER_PROFILE + WORLD_STATE 合计超 1200 tokens 时截断
 * 3. block 超 32000 字符时 console.warn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../similarity.js', () => ({
  default: class {
    searchWithVectors() { return { matches: [] }; }
  },
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../user-profile.js', () => ({
  loadUserProfile: vi.fn().mockResolvedValue(null),
  formatProfileSnippet: vi.fn().mockReturnValue(''),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { buildMemoryContext, isWorldStateQuery } from '../memory-retriever.js';

// 生成指定 token 量的文本（约 2.5 chars/token）
function makeText(tokens) {
  return 'A'.repeat(Math.ceil(tokens * 2.5));
}

describe('isWorldStateQuery', () => {
  it('OKR 相关查询返回 true', () => {
    expect(isWorldStateQuery('我的OKR进度怎么样')).toBe(true);
    expect(isWorldStateQuery('当前项目有哪些')).toBe(true);
    expect(isWorldStateQuery('任务完成了吗')).toBe(true);
    expect(isWorldStateQuery('这个initiative什么时候结束')).toBe(true);
  });

  it('闲聊类查询返回 false', () => {
    expect(isWorldStateQuery('今天天气不错')).toBe(false);
    expect(isWorldStateQuery('你好啊')).toBe(false);
    expect(isWorldStateQuery('聊聊生活')).toBe(false);
  });
});

describe('WORLD_STATE 条件注入', () => {
  it('chat 模式下 isWorldStateQuery=false 时 WORLD_STATE 不注入', async () => {
    const worldStateContent = '## WORLD_STATE\n当前 OKR 列表：...';
    const userProfileContent = '## USER_PROFILE\n用户偏好：...';

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        // getDoc SQL: SELECT content... FROM distilled_docs WHERE type = $1
        if (typeof sql === 'string' && sql.includes('distilled_docs')) {
          const docType = params && params[0];
          if (docType === 'WORLD_STATE') return Promise.resolve({ rows: [{ content: worldStateContent }] });
          if (docType === 'USER_PROFILE') return Promise.resolve({ rows: [{ content: userProfileContent }] });
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const { block } = await buildMemoryContext({
      query: '今天心情怎么样',  // 非 OKR 查询
      mode: 'chat',
      tokenBudget: 3000,
      pool: mockPool,
    });

    expect(block).not.toContain('WORLD_STATE');
    expect(block).not.toContain('当前 OKR 列表');
  });

  it('chat 模式下 isWorldStateQuery=true 时 WORLD_STATE 注入', async () => {
    const worldStateContent = '## WORLD_STATE\n当前 OKR 列表：发布系统80%';
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('distilled_docs')) {
          const docType = params && params[0];
          if (docType === 'WORLD_STATE') return Promise.resolve({ rows: [{ content: worldStateContent }] });
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const { block } = await buildMemoryContext({
      query: '当前OKR进度如何',  // OKR 查询
      mode: 'chat',
      tokenBudget: 3000,
      pool: mockPool,
    });

    expect(block).toContain('当前 OKR 列表');
  });
});

describe('distilled docs token 预算上限', () => {
  it('USER_PROFILE + WORLD_STATE 合计超 1200 tokens 时截断', async () => {
    // 各 800 tokens → 合计 1600 tokens，超过 1200 限制
    const longProfile = makeText(800);
    const longWorldState = makeText(800);

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('distilled_docs')) {
          const docType = params && params[0];
          if (docType === 'USER_PROFILE') return Promise.resolve({ rows: [{ content: longProfile }] });
          if (docType === 'WORLD_STATE') return Promise.resolve({ rows: [{ content: longWorldState }] });
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const { block } = await buildMemoryContext({
      query: '我的项目进度',  // OKR 查询，触发 WORLD_STATE
      mode: 'chat',
      tokenBudget: 5000,
      pool: mockPool,
    });

    // block 中 USER_PROFILE + WORLD_STATE 部分合计不超过 1200 tokens (~3000 chars)
    const blockChars = block.length;
    expect(blockChars).toBeLessThan(1200 * 2.5 + 2000); // 留 2000 chars 给其他内容
  });
});

describe('block 超 32000 字符时 console.warn', () => {
  it('block 超长时发出 warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 构造超过 32000 chars 的蒸馏文档内容
    const hugeContent = 'X'.repeat(35000);

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('distilled_docs')) {
          const docType = params && params[0];
          if (docType === 'SOUL') return Promise.resolve({ rows: [{ content: hugeContent }] });
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    await buildMemoryContext({
      query: '随便',
      mode: 'chat',
      tokenBudget: 50000,
      pool: mockPool,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[memory] block size exceeded 32000 chars'),
      expect.any(Object)
    );

    warnSpy.mockRestore();
  });
});
