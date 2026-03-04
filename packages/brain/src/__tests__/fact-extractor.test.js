/**
 * fact-extractor 混合提取测试
 *
 * DoD 映射：
 *   H1-1: Haiku 补全正则漏掉的偏好
 *   H1-2: gap 写入 learned_keywords
 *   H1-3: 合并去重不重复
 *   H2-1: 动态词库命中学到的关键词
 *   H3-1: Haiku 失败时正则结果正常保存
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractFacts,
  loadLearnedKeywords,
  saveLearnedKeywords,
  extractFactsWithHaiku,
  processMessageFacts,
  invalidateKeywordCache,
} from '../fact-extractor.js';

// ─────────────────────────────────────────────
// Mock Pool 工厂
// ─────────────────────────────────────────────

function makePool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

beforeEach(() => {
  invalidateKeywordCache('owner');
  invalidateKeywordCache('user-1');
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────
// H1-1: Haiku 补全正则漏掉的偏好
// ─────────────────────────────────────────────

describe('H1-1: Haiku 补全正则漏掉的偏好', () => {
  it('正则漏掉"也喜欢工作，旅游"，Haiku 补全并写入 person_signals', async () => {
    const message = '我喜欢咖啡，也喜欢工作，旅游';

    // 正则只能捕获"咖啡"（"我喜欢咖啡"命中），漏掉"工作"和"旅游"
    const { preferences: regexPrefs } = extractFacts(message);
    expect(regexPrefs.map(p => p.value)).toContain('咖啡');
    expect(regexPrefs.map(p => p.value)).not.toContain('工作');
    expect(regexPrefs.map(p => p.value)).not.toContain('旅游');

    // Haiku 返回补全结果（含正则已有的咖啡 + 漏掉的工作/旅游）
    const mockCallLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        preferences: [
          { value: '咖啡', polarity: 'positive' },
          { value: '工作', polarity: 'positive' },
          { value: '旅游', polarity: 'positive' },
        ],
      }),
    });

    const pool = makePool();
    const gaps = await extractFactsWithHaiku(message, regexPrefs, pool, 'owner', mockCallLLM);

    // gaps 只包含正则漏掉的（工作、旅游）
    expect(gaps.map(g => g.value)).toContain('工作');
    expect(gaps.map(g => g.value)).toContain('旅游');
    expect(gaps.map(g => g.value)).not.toContain('咖啡');

    // Haiku 必须被调用一次
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledWith('fact_extractor', expect.any(String), expect.any(Object));
  });
});

// ─────────────────────────────────────────────
// H1-2: gap 写入 learned_keywords
// ─────────────────────────────────────────────

describe('H1-2: gap 写入 learned_keywords', () => {
  it('Haiku 发现的 gap 写入 learned_keywords 表', async () => {
    const insertedKeywords = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql && sql.includes('INSERT INTO learned_keywords')) {
          insertedKeywords.push(params[1]); // keyword = params[1]
        }
        return { rows: [] };
      }),
    };

    const message = '也喜欢工作，旅游';
    const regexPrefs = []; // 正则啥都没捕到

    const mockCallLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        preferences: [
          { value: '工作', polarity: 'positive' },
          { value: '旅游', polarity: 'positive' },
        ],
      }),
    });

    await extractFactsWithHaiku(message, regexPrefs, pool, 'owner', mockCallLLM);

    expect(insertedKeywords).toContain('工作');
    expect(insertedKeywords).toContain('旅游');
  });

  it('saveLearnedKeywords 使用 ON CONFLICT 更新 use_count', async () => {
    const sqls = [];
    const pool = {
      query: vi.fn(async (sql) => {
        sqls.push(sql);
        return { rows: [] };
      }),
    };

    await saveLearnedKeywords(pool, 'owner', [{ value: '旅游', polarity: 'positive' }]);

    expect(sqls[0]).toContain('ON CONFLICT');
    expect(sqls[0]).toContain('use_count');
  });
});

// ─────────────────────────────────────────────
// H1-3: 合并去重不重复
// ─────────────────────────────────────────────

describe('H1-3: 合并去重不重复', () => {
  it('正则和 Haiku 都发现同一关键词，Haiku gaps 为空', async () => {
    const message = '我喜欢咖啡';

    const { preferences: regexPrefs } = extractFacts(message);
    expect(regexPrefs.map(p => p.value)).toContain('咖啡');

    const mockCallLLM = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        preferences: [{ value: '咖啡', polarity: 'positive' }],
      }),
    });

    const pool = makePool();
    const gaps = await extractFactsWithHaiku(message, regexPrefs, pool, 'owner', mockCallLLM);

    // gaps 应为空（咖啡正则已有）
    expect(gaps).toHaveLength(0);

    // 没有写入 learned_keywords（无 gap）
    const insertCalls = pool.query.mock.calls.filter(
      ([sql]) => sql && sql.includes('INSERT INTO learned_keywords')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('learnedKeywords 不重复添加正则已有的 value', () => {
    const message = '我喜欢咖啡';
    const { preferences: regexPrefs } = extractFacts(message);

    // 即使 learnedKeywords 包含咖啡，也不会在结果中重复出现（Set 去重）
    const learnedKeywords = [{ keyword: '咖啡', polarity: 'positive' }];
    const { preferences: withLearned } = extractFacts(message, learnedKeywords);

    const learnedCount = withLearned.filter(p => p.source === 'learned' && p.value === '咖啡').length;
    expect(learnedCount).toBe(0); // 已在正则中命中，learned 不会再添加
  });
});

// ─────────────────────────────────────────────
// H2-1: 动态词库命中学到的关键词
// ─────────────────────────────────────────────

describe('H2-1: 动态词库命中学到的关键词', () => {
  it('loadLearnedKeywords 加载后，extractFacts 能命中"旅游"', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ keyword: '旅游', polarity: 'positive' }],
      }),
    };

    const learnedKeywords = await loadLearnedKeywords(pool, 'owner');
    expect(learnedKeywords).toEqual([{ keyword: '旅游', polarity: 'positive' }]);

    // 以前正则漏掉的"也喜欢旅游"，加载 learnedKeywords 后可以命中
    const { preferences } = extractFacts('也喜欢旅游', learnedKeywords);
    const found = preferences.find(p => p.value === '旅游');
    expect(found).toBeDefined();
    expect(found.source).toBe('learned');
  });

  it('loadLearnedKeywords 使用 TTL 缓存，5分钟内不重复查询 DB', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ keyword: '咖啡', polarity: 'positive' }],
      }),
    };

    await loadLearnedKeywords(pool, 'user-1');
    await loadLearnedKeywords(pool, 'user-1'); // 第二次从缓存读
    expect(pool.query).toHaveBeenCalledTimes(1); // DB 只查了一次
  });

  it('invalidateKeywordCache 后重新查 DB', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ keyword: '跑步', polarity: 'habit' }],
      }),
    };

    await loadLearnedKeywords(pool, 'user-1');
    invalidateKeywordCache('user-1');
    await loadLearnedKeywords(pool, 'user-1'); // 缓存被清，重新查 DB
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────
// H3-1: Haiku 失败时正则结果正常保存
// ─────────────────────────────────────────────

describe('H3-1: Haiku 失败时正则结果正常保存', () => {
  it('Haiku 抛出异常，processMessageFacts 正则结果仍然写入', async () => {
    const insertedSignals = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql && sql.includes('INSERT INTO person_signals')) {
          insertedSignals.push(params[1]); // signal_value
        }
        return { rows: [] };
      }),
    };

    // Haiku 超时失败
    const failingLLM = vi.fn().mockRejectedValue(new Error('Haiku timeout'));

    await processMessageFacts(pool, 'owner', '我喜欢咖啡', failingLLM);

    // 正则结果必须被写入（"咖啡"）
    expect(insertedSignals).toContain('咖啡');
  });

  it('Haiku 返回无效 JSON，extractFactsWithHaiku 返回空数组，不报错', async () => {
    const pool = makePool();
    const badLLM = vi.fn().mockResolvedValue({ text: 'not valid json at all' });

    const result = await extractFactsWithHaiku('也喜欢旅游', [], pool, 'owner', badLLM);
    expect(result).toEqual([]);
  });

  it('callLLMFn 为 null 时，processMessageFacts 只跑正则', async () => {
    const insertedSignals = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql && sql.includes('INSERT INTO person_signals')) {
          insertedSignals.push(params[1]);
        }
        return { rows: [] };
      }),
    };

    await processMessageFacts(pool, 'owner', '我喜欢咖啡', null);
    expect(insertedSignals).toContain('咖啡');
  });
});
