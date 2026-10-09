/**
 * topic-selector.test.js
 *
 * 零行为变化断言：getContentGapContext() 原先把 task_type 白名单硬编码在
 * SQL 字面量里（`task_type IN ('content-pipeline','content_pipeline','content_generation')`，
 * 见基线 commit 5c232c9da），Task 4 改成参数化查询
 * （`task_type = ANY($1::text[])` + 派生常量 CONTENT_GAP_LEGACY_TASK_TYPES）。
 * 本文件真 import topic-selector.js（不 mock 被测模块本身，只 stub 它依赖的
 * pool.query），断言改写后传给 SQL 的白名单集合与改写前的字面量 fixture
 * 逐一相等（含个数、含顺序——这三个拼写是历史遗留，顺序本身也是原文一部分）。
 */
import { describe, it, expect, vi } from 'vitest';
import { getContentGapContext } from '../topic-selector.js';

// 基线字面量 fixture：从 `git show 5c232c9da:packages/brain/src/topic-selector.js`
// 原样抄出的 SQL IN 列表，替换前 getContentGapContext() 的实际白名单。
const LEGACY_LITERAL_TASK_TYPES = ['content-pipeline', 'content_pipeline', 'content_generation'];

function fakePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('topic-selector: getContentGapContext 零行为变化', () => {
  it('SQL 改参数化后，传给查询的白名单集合与替换前的 SQL 字面量逐一相等（含顺序）', async () => {
    const pool = fakePool([]);
    await getContentGapContext(pool);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];

    // 语法上必须已经改成参数化查询，不再是裸字面量 IN (...)
    expect(sql).toMatch(/task_type\s*=\s*ANY\(\$1::text\[\]\)/);
    expect(sql).not.toMatch(/task_type\s+IN\s*\(/);

    // 白名单集合本身对基线字面量零行为变化：长度先钉住，再比全等（含顺序）
    expect(params).toHaveLength(1);
    const whitelist = params[0];
    expect(whitelist.length).toBe(LEGACY_LITERAL_TASK_TYPES.length);
    expect(whitelist).toEqual(LEGACY_LITERAL_TASK_TYPES);
  });

  it('派生常量本身是冻结的（防运行期被别处 push 篡改）', async () => {
    const pool = fakePool([]);
    await getContentGapContext(pool);
    const [, params] = pool.query.mock.calls[0];
    const whitelist = params[0];
    expect(Object.isFrozen(whitelist)).toBe(true);
    expect(() => { whitelist.push('rogue'); }).toThrow();
  });

  it('30 天窗口与 content_type 非空过滤条件未被参数化改写波及', async () => {
    const pool = fakePool([]);
    await getContentGapContext(pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain("created_at >= NOW() - INTERVAL '30 days'");
    expect(sql).toContain("payload->>'content_type' IS NOT NULL");
  });

  it('rows 为空时返回空字符串，query 抛错时兜底返回空字符串（不抛给调用方）', async () => {
    expect(await getContentGapContext(fakePool([]))).toBe('');

    const throwingPool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    expect(await getContentGapContext(throwingPool)).toBe('');
  });

  it('有缺口的类型进结果段落，措辞含"内容库缺口方向"', async () => {
    const pool = fakePool([
      { content_type: 'ai-tools-review', cnt: '1' },
      { content_type: 'solo-company-case', cnt: '20' },
    ]);
    const ctx = await getContentGapContext(pool);
    expect(ctx).toContain('内容库缺口方向');
    expect(ctx).toContain('ai-tools-review');
  });
});
