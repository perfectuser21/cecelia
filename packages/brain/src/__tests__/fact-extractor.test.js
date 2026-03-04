/**
 * fact-extractor.test.js
 *
 * 覆盖 DoD 验收条件：
 *   F1-1: 短事实（≥5字）→ extractFacts 捕获偏好
 *   F1-2: 负向偏好 → polarity='negative'
 *   F1-3: 行为纠正 → corrections 数组
 *   F1-4: 纯噪音不产生事实
 *   F2-1: 矛盾偏好 → detectContradictions 返回矛盾
 *   F2-2: 颜色可并存，不触发矛盾
 *   F3-1: savePreferences 写入 person_signals
 *   F3-2: saveClarificationRequests 写入 pending_conversations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractFacts,
  savePreferences,
  saveCorrections,
  detectContradictions,
  saveClarificationRequests,
  processMessageFacts,
} from '../fact-extractor.js';

// ─── Mock pool 工厂 ───────────────────────────────────────────

function makePool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

// ─── F1 extractFacts（纯函数，无 DB）────────────────────────

describe('F1-1: 短事实提取（≥5字正向偏好）', () => {
  it('我喜欢喝茶 → 偏好 polarity=positive', () => {
    const { preferences } = extractFacts('我喜欢喝茶');
    expect(preferences.length).toBeGreaterThan(0);
    expect(preferences[0].polarity).toBe('positive');
    expect(preferences[0].value).toContain('喝茶');
  });

  it('我喜欢蓝色 → 偏好 polarity=positive', () => {
    const { preferences } = extractFacts('我喜欢蓝色');
    expect(preferences.length).toBeGreaterThan(0);
    expect(preferences[0].value).toContain('蓝色');
  });

  it('多个偏好同时捕获', () => {
    const { preferences } = extractFacts('我喜欢喝咖啡，我习惯早起工作');
    // 应至少捕获到1个
    expect(preferences.length).toBeGreaterThanOrEqual(1);
  });
});

describe('F1-2: 负向偏好', () => {
  it('我不喜欢开会 → polarity=negative', () => {
    const { preferences } = extractFacts('我不喜欢开会');
    expect(preferences.length).toBeGreaterThan(0);
    expect(preferences[0].polarity).toBe('negative');
  });

  it('我讨厌噪音 → polarity=negative', () => {
    const { preferences } = extractFacts('我讨厌噪音');
    expect(preferences.length).toBeGreaterThan(0);
    expect(preferences[0].polarity).toBe('negative');
  });
});

describe('F1-3: 行为纠正', () => {
  it('你不应该沉默 → corrections 数组', () => {
    const { corrections } = extractFacts('你不应该沉默');
    expect(corrections.length).toBeGreaterThan(0);
    expect(corrections[0].value).toContain('沉默');
  });

  it('你应该主动回复 → corrections 数组', () => {
    const { corrections } = extractFacts('你应该主动回复');
    expect(corrections.length).toBeGreaterThan(0);
  });

  it('下次你别这样做 → corrections 数组', () => {
    const { corrections } = extractFacts('下次你别这样做');
    expect(corrections.length).toBeGreaterThan(0);
  });
});

describe('F1-4: 噪音过滤', () => {
  it('空字符串不产生任何事实', () => {
    const result = extractFacts('');
    expect(result.preferences).toHaveLength(0);
    expect(result.corrections).toHaveLength(0);
  });

  it('纯语气词不产生事实', () => {
    const { preferences } = extractFacts('好的，嗯，行，对对对');
    // 噪音词过滤后不应有有效事实
    expect(preferences.length).toBe(0);
  });

  it('太短的文本（<3字）不产生事实', () => {
    const result = extractFacts('哦');
    expect(result.preferences).toHaveLength(0);
    expect(result.corrections).toHaveLength(0);
  });
});

// ─── F2 矛盾检测（需要 DB mock）──────────────────────────────

describe('F2-1: 矛盾偏好检测 → pending_conversations', () => {
  it('喜欢茶 vs 已有喜欢咖啡 → 检测到矛盾', async () => {
    const pool = makePool([{ signal_value: '咖啡', raw_excerpt: '我喜欢咖啡' }]);
    const newPrefs = [{ value: '喝茶', polarity: 'positive' }];
    const contradictions = await detectContradictions(pool, 'owner', newPrefs);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].existingValue).toBe('咖啡');
    expect(contradictions[0].newValue).toBe('喝茶');
  });

  it('同值不算矛盾（重复偏好）', async () => {
    const pool = makePool([{ signal_value: '咖啡', raw_excerpt: '我喜欢咖啡' }]);
    const newPrefs = [{ value: '咖啡', polarity: 'positive' }];
    const contradictions = await detectContradictions(pool, 'owner', newPrefs);
    expect(contradictions).toHaveLength(0);
  });
});

describe('F2-2: 颜色可并存，不触发矛盾', () => {
  it('喜欢蓝色 vs 已有喜欢红色 → 不矛盾（颜色非互斥）', async () => {
    const pool = makePool([{ signal_value: '红色', raw_excerpt: '我喜欢红色' }]);
    const newPrefs = [{ value: '蓝色', polarity: 'positive' }];
    const contradictions = await detectContradictions(pool, 'owner', newPrefs);
    expect(contradictions).toHaveLength(0);
  });
});

// ─── F3 存储（DB mock 验证写入行为）────────────────────────

describe('F3-1: savePreferences 写入 person_signals', () => {
  it('新偏好写入 person_signals', async () => {
    const pool = makePool([]); // 去重查询返回空 → 不重复
    await savePreferences(pool, 'owner', [{ value: '喝茶', polarity: 'positive', raw: '我喜欢喝茶', temporal: 'current' }]);
    // 应有2次 query：1次去重检查 + 1次 INSERT
    expect(pool.query).toHaveBeenCalledTimes(2);
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO person_signals');
    expect(insertCall[1][1]).toBe('喝茶'); // signal_value = '喝茶'
  });

  it('7天内重复偏好不重写', async () => {
    const pool = makePool([{ id: 1 }]); // 去重查询返回已有记录
    await savePreferences(pool, 'owner', [{ value: '喝茶', polarity: 'positive', raw: '我喜欢喝茶', temporal: 'current' }]);
    // 只有1次查询（去重检查），无 INSERT
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('F3-2: saveClarificationRequests 写入 pending_conversations', () => {
  it('矛盾 → 写入 pending_conversations 澄清请求', async () => {
    const pool = makePool([]); // 无已有澄清请求
    const contradictions = [{ newValue: '喝茶', existingValue: '咖啡', category: 'drink' }];
    await saveClarificationRequests(pool, 'owner', contradictions);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO pending_conversations');
    expect(insertCall[1][1]).toContain('喜欢');
  });

  it('已有澄清请求时不重复写入', async () => {
    const pool = makePool([{ id: 1 }]); // 已有同类澄清
    const contradictions = [{ newValue: '喝茶', existingValue: '咖啡', category: 'drink' }];
    await saveClarificationRequests(pool, 'owner', contradictions);
    // 只有1次查询，无 INSERT
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

// ─── processMessageFacts 整合测试 ──────────────────────────

describe('processMessageFacts 整合', () => {
  it('无事实的消息不调用 DB', async () => {
    const pool = makePool([]);
    await processMessageFacts(pool, 'owner', '好的');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('有偏好的消息调用 DB 写入', async () => {
    const pool = makePool([]); // 所有查询返回空（无重复、无矛盾）
    await processMessageFacts(pool, 'owner', '我喜欢喝茶');
    // 至少有 savePreferences 的2次 query
    expect(pool.query.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
