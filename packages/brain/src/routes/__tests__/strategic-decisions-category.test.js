/**
 * POST /api/brain/strategic-decisions — 枚举字段校验回归 [BEHAVIOR]
 *
 * 生产实测：category=workflow_bogus 返回 500，并把数据库约束原文
 * 「violates check constraint "decisions_category_chk"」透给调用方。
 * 期望：非法 category/made_by/priority 写库前 400 并给出合法值；缺省 category 写 decision；
 * 数据库异常不回显原文。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

const { default: router } = await import('../strategic-decisions.js');
const {
  DECISION_CATEGORIES, DEFAULT_DECISION_CATEGORY, DECISION_MADE_BY, DECISION_PRIORITIES,
  isValidDecisionCategory,
} = await import('../../decision-categories.js');

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/', router);
  return app;
}

const post = (body) => request(makeApp()).post('/').send({ topic: 't', decision: 'd', ...body });
const insertCalls = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO decisions/.test(sql));

function quotedValues(sqlFragment) {
  return [...sqlFragment.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('POST /strategic-decisions 枚举字段校验', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'x' }] });
  });

  it('非法 category → 400，列出合法值，不回显约束名，不写库', async () => {
    const res = await post({ category: 'workflow_bogus' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.allowed_categories).toEqual([...DECISION_CATEGORIES]);
    expect(res.body.error).toContain('decision');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('decisions_category_chk');
    expect(text).not.toContain('violates');
    expect(text).not.toContain('relation');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['大小写变体', 'Decision'],
    ['前导空格', ' decision'],
    ['数字', 1],
    ['数组', ['decision']],
    ['对象', { v: 'decision' }],
    ['超长字符串', 'a'.repeat(10000)],
  ])('category 为%s → 400 且不写库', async (_label, category) => {
    const res = await post({ category });
    expect(res.status).toBe(400);
    expect(res.body.allowed_categories).toEqual([...DECISION_CATEGORIES]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['不带 category', {}],
    ['category=null', { category: null }],
    ["category=''", { category: '' }],
  ])('%s → 201，写入缺省 decision', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(insertCalls()).toHaveLength(1);
    expect(insertCalls()[0][1][0]).toBe('decision');
  });

  it("合法 category 'judgment' → 201，原样写入", async () => {
    const res = await post({ category: 'judgment' });
    expect(res.status).toBe(201);
    expect(insertCalls()[0][1][0]).toBe('judgment');
  });

  it('数据库 check_violation → 400，只给字段名，不回显原文', async () => {
    const raw = 'new row for relation "decisions" violates check constraint "decisions_category_chk"';
    mockQuery.mockRejectedValueOnce(Object.assign(new Error(raw), { code: '23514', constraint: 'decisions_category_chk' }));
    const res = await post({ category: 'judgment' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('category');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('decisions_category_chk');
    expect(text).not.toContain('violates');
  });

  it('数据库 check_violation 约束名未知 → 400，字段写「未知」', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '23514', constraint: 'other_chk' }));
    const res = await post({ category: 'judgment' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('未知');
    expect(JSON.stringify(res.body)).not.toContain('other_chk');
  });

  it('其它数据库异常 → 500，不回显原文', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom SQL'));
    const res = await post({ category: 'judgment' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: '创建决策失败' });
  });

  it("made_by='ai' → 400 带 allowed_made_by，不写库；made_by='system' → 201", async () => {
    let res = await post({ category: 'judgment', made_by: 'ai' });
    expect(res.status).toBe(400);
    expect(res.body.allowed_made_by).toEqual([...DECISION_MADE_BY]);
    expect(res.body.error).toContain('made_by');
    expect(mockQuery).not.toHaveBeenCalled();

    res = await post({ category: 'judgment', made_by: 'system' });
    expect(res.status).toBe(201);
    expect(insertCalls()[0][1][6]).toBe('system');
  });

  it("priority='P9' → 400 带 allowed_priorities，不写库", async () => {
    const res = await post({ priority: 'P9' });
    expect(res.status).toBe(400);
    expect(res.body.allowed_priorities).toEqual([...DECISION_PRIORITIES]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('decision-categories 常量与 migration 漂移守卫', () => {
  it('category 允许值 = migration 384 decisions_category_chk', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, '384_decisions_nfr_category.sql'), 'utf8');
    const m = sql.match(/category IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    expect(new Set(quotedValues(m[1]))).toEqual(new Set(DECISION_CATEGORIES));
    expect(DECISION_CATEGORIES).toHaveLength(13);
  });

  it('made_by / priority 允许值 = migration 193 decisions 段', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, '193_knowledge_doc_author.sql'), 'utf8');
    const seg = sql.slice(sql.indexOf('ALTER TABLE decisions'), sql.indexOf('ALTER TABLE learnings'));
    expect(new Set(quotedValues(seg.match(/made_by IN \(([^)]*)\)/)[1]))).toEqual(new Set(DECISION_MADE_BY));
    expect(new Set(quotedValues(seg.match(/priority IN \(([^)]*)\)/)[1]))).toEqual(new Set(DECISION_PRIORITIES));
  });

  it('缺省值在允许列表内；isValidDecisionCategory 大小写敏感、拒非字符串', () => {
    expect(DEFAULT_DECISION_CATEGORY).toBe('decision');
    expect(isValidDecisionCategory(DEFAULT_DECISION_CATEGORY)).toBe(true);
    expect(isValidDecisionCategory('Decision')).toBe(false);
    expect(isValidDecisionCategory(['decision'])).toBe(false);
    expect(Object.isFrozen(DECISION_CATEGORIES)).toBe(true);
  });
});
