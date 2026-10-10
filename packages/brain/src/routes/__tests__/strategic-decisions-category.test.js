/**
 * POST /api/brain/strategic-decisions — category 非法返回 400 [BEHAVIOR]
 *
 * 允许值只从数据库约束 decisions_category_chk 读取（不手抄枚举）；
 * 非法值写库前拦下 400，响应不透出约束名 / SQL 原文；23514 兜底同形 400。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

const { default: router, _resetAllowedCategoriesCache } = await import('../strategic-decisions.js');

const DEF_V1 = "CHECK (((category IS NULL) OR ((category)::text = ANY ((ARRAY['decision'::character varying, 'general'::character varying, 'judgment'::character varying])::text[]))))";
const DEF_V2 = "CHECK (((category IS NULL) OR ((category)::text = ANY ((ARRAY['decision'::character varying, 'general'::character varying, 'judgment'::character varying, 'retro'::character varying])::text[]))))";
const SQL_LEAK = /decisions_category_chk|check constraint|violates|relation "decisions"/i;

function findHandler(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

let constraintDef;
let constraintError;
let insertError;

function installDb() {
  mockQuery.mockImplementation(async (sql, params) => {
    if (/pg_constraint/.test(sql)) {
      if (constraintError) throw constraintError;
      return { rows: [{ def: constraintDef }] };
    }
    if (/INSERT INTO decisions/.test(sql)) {
      if (insertError) throw insertError;
      return { rows: [{ id: 'new-id', category: params[0], topic: params[1] }] };
    }
    return { rows: [] };
  });
}

const insertCalls = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO decisions/.test(sql));
const constraintCalls = () => mockQuery.mock.calls.filter(([sql]) => /pg_constraint/.test(sql));

async function post(body) {
  const res = mockRes();
  await findHandler('post', '/')({ body }, res);
  return res;
}

describe('POST /strategic-decisions category 校验', () => {
  beforeEach(() => {
    _resetAllowedCategoriesCache();
    mockQuery.mockReset();
    constraintDef = DEF_V1;
    constraintError = null;
    insertError = null;
    installDb();
  });

  it('非法 category → 400，allowed_categories 来自数据库约束，不透出 SQL，不写库', async () => {
    const res = await post({ category: 'workflow_bogus', topic: 't', decision: 'd' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.allowed_categories).toEqual(['decision', 'general', 'judgment']);
    expect(res.body.error).toBe('category 非法，合法值：decision|general|judgment');
    expect(JSON.stringify(res.body)).not.toMatch(SQL_LEAK);
    expect(insertCalls()).toHaveLength(0);
  });

  it('非字符串 category（数字/数组/对象/布尔）→ 400，不写库', async () => {
    for (const category of [123, ['decision'], {}, true]) {
      const res = await post({ category, topic: 't', decision: 'd' });
      expect(res.statusCode).toBe(400);
      expect(res.body.allowed_categories).toEqual(['decision', 'general', 'judgment']);
    }
    expect(insertCalls()).toHaveLength(0);
  });

  it('超长 / 大小写变体 / 带空格 → 400，不写库', async () => {
    for (const category of ['x'.repeat(5000), 'Decision', ' decision']) {
      const res = await post({ category, topic: 't', decision: 'd' });
      expect(res.statusCode).toBe(400);
    }
    expect(insertCalls()).toHaveLength(0);
  });

  it('合法 category → INSERT 带该值，201', async () => {
    const res = await post({ category: 'decision', topic: 't', decision: 'd' });
    expect(res.statusCode).toBe(201);
    expect(insertCalls()).toHaveLength(1);
    expect(insertCalls()[0][1]).toContain('decision');
  });

  it('不带 category / 空串 / null → 跳过校验，默认 general，201', async () => {
    for (const category of [undefined, '', null]) {
      const res = await post({ category, topic: 't', decision: 'd' });
      expect(res.statusCode).toBe(201);
    }
    expect(constraintCalls()).toHaveLength(0);
    expect(insertCalls().map(([, p]) => p[0])).toEqual(['general', 'general', 'general']);
  });

  it('缓存过期：约束加宽后不在缓存的新值会重读约束并放行', async () => {
    expect((await post({ category: 'decision', topic: 't', decision: 'd' })).statusCode).toBe(201);
    const before = constraintCalls().length;
    constraintDef = DEF_V2;
    const res = await post({ category: 'retro', topic: 't', decision: 'd' });
    expect(res.statusCode).toBe(201);
    expect(constraintCalls().length).toBe(before + 1);
    expect(insertCalls().at(-1)[1]).toContain('retro');
  });

  it('约束读取失败且无缓存：非法 / 超长 category 不进 INSERT，503 不透出 SQL 原文', async () => {
    constraintError = Object.assign(new Error('relation "pg_constraint" connection terminated'), { code: '57P01' });
    insertError = Object.assign(
      new Error('value too long for type character varying(50)'),
      { code: '22001' }
    );
    for (const category of ['workflow_bogus', 'x'.repeat(5000), 'decision']) {
      const res = await post({ category, topic: 't', decision: 'd' });
      expect(res.statusCode).toBe(503);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/decisions_category_chk|check constraint|violates|relation|character varying|connection/i);
    }
    expect(insertCalls()).toHaveLength(0);
  });

  it('约束重读失败但有缓存：非法 / 超长 category 用缓存列出允许值 → 400，不写库', async () => {
    expect((await post({ category: 'decision', topic: 't', decision: 'd' })).statusCode).toBe(201);
    constraintError = new Error('boom');
    for (const category of ['workflow_bogus', 'x'.repeat(5000)]) {
      const res = await post({ category, topic: 't', decision: 'd' });
      expect(res.statusCode).toBe(400);
      expect(res.body.allowed_categories).toEqual(['decision', 'general', 'judgment']);
      expect(res.body.error).toBe('category 非法，合法值：decision|general|judgment');
    }
    expect(insertCalls()).toHaveLength(1);
  });

  it('兜底：预检后约束被收窄，INSERT 撞 23514 → 400 列出重读后的允许值，不透出 SQL 原文', async () => {
    constraintDef = DEF_V2;
    insertError = Object.assign(
      new Error('new row for relation "decisions" violates check constraint "decisions_category_chk"'),
      { code: '23514', constraint: 'decisions_category_chk' }
    );
    mockQuery.mockImplementation(async (sql, params) => {
      if (/pg_constraint/.test(sql)) return { rows: [{ def: constraintDef }] };
      if (/INSERT INTO decisions/.test(sql)) { constraintDef = DEF_V1; throw insertError; }
      return { rows: [] };
    });
    const res = await post({ category: 'retro', topic: 't', decision: 'd' });
    expect(insertCalls()).toHaveLength(1);
    expect(res.statusCode).toBe(400);
    expect(res.body.allowed_categories).toEqual(['decision', 'general', 'judgment']);
    expect(JSON.stringify(res.body)).not.toMatch(SQL_LEAK);
  });

  it('兜底：23514 后重读约束失败 → 用缓存列出允许值，不返回空列表', async () => {
    insertError = Object.assign(
      new Error('new row for relation "decisions" violates check constraint "decisions_category_chk"'),
      { code: '23514', constraint: 'decisions_category_chk' }
    );
    mockQuery.mockImplementation(async (sql, params) => {
      if (/pg_constraint/.test(sql)) {
        if (constraintError) throw constraintError;
        return { rows: [{ def: constraintDef }] };
      }
      if (/INSERT INTO decisions/.test(sql)) { constraintError = new Error('boom'); throw insertError; }
      return { rows: [] };
    });
    const res = await post({ category: 'decision', topic: 't', decision: 'd' });
    expect(res.statusCode).toBe(400);
    expect(res.body.allowed_categories).toEqual(['decision', 'general', 'judgment']);
    expect(JSON.stringify(res.body)).not.toMatch(SQL_LEAK);
  });

  it('其它数据库错误仍 500', async () => {
    insertError = Object.assign(new Error('connection lost'), { code: '08006' });
    const res = await post({ category: 'decision', topic: 't', decision: 'd' });
    expect(res.statusCode).toBe(500);
  });
});
