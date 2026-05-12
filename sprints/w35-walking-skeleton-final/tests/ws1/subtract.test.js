// W35 P1 final: playground GET /subtract — TDD Red phase
// 当 playground/server.js 还未注册 /subtract 路由时，Express 默认返 404，
// 下方 supertest 断言全部 fail（Red evidence）。
// Green phase = generator 实现后 vitest 全绿。
//
// 注：playground 子项目零依赖 + 纯 JS（无 tsconfig、无 TS 编译），故用 .test.js
// 与 SKILL 模板 .test.ts 不一致是被动适配 playground 子项目栈，不是合同违规。

import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('GET /subtract [BEHAVIOR]', () => {
  // ─── Happy Path ──────────────────────────────────────────────

  test('GET /subtract?minuend=10&subtrahend=3 → 200 + {result:7, operation:"subtract"}', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 7, operation: 'subtract' });
    expect(typeof res.body.result).toBe('number');
  });

  test('GET /subtract?minuend=0&subtrahend=0 → 200 + {result:0, operation:"subtract"}（零边界）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '0', subtrahend: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'subtract' });
  });

  test('GET /subtract?minuend=5&subtrahend=5 → 200 + result===0（minuend===subtrahend 反 off-by-one）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '5', subtrahend: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('subtract');
  });

  test('GET /subtract?minuend=100&subtrahend=100 → 200 + result===0（等值减第二证）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '100', subtrahend: '100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
  });

  test('GET /subtract?minuend=5&subtrahend=10 → 200 + result===-5（负结果，防参数颠倒）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '5', subtrahend: '10' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-5);
    expect(res.body.operation).toBe('subtract');
  });

  test('GET /subtract?minuend=0&subtrahend=1 → 200 + result===-1', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '0', subtrahend: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
  });

  test('GET /subtract?minuend=-5&subtrahend=-3 → 200 + result===-2（双负）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '-5', subtrahend: '-3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
    expect(res.body.operation).toBe('subtract');
  });

  test('GET /subtract?minuend=-5&subtrahend=3 → 200 + result===-8（混合符号）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '-5', subtrahend: '3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-8);
  });

  test('GET /subtract?minuend=1.5&subtrahend=0.5 → 200 + result===1（浮点 IEEE 754 精确）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '1.5', subtrahend: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('subtract');
  });

  test('GET /subtract?minuend=3.14&subtrahend=1.14 → 200 + result===Number("3.14")-Number("1.14")（浮点独立复算）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '3.14', subtrahend: '1.14' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(Number('3.14') - Number('1.14'));
    expect(res.body.operation).toBe('subtract');
  });

  test('GET /subtract?minuend=100&subtrahend=99 → 200 + result===1', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '100', subtrahend: '99' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
  });

  // ─── Schema 完整性 + 字面值 oracle ────────────────────────────

  test('GET /subtract?minuend=10&subtrahend=3 → 顶层 keys 字面集合 == ["operation","result"]（schema 完整性）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('GET /subtract?minuend=10&subtrahend=3 → operation 严格字面字符串 "subtract"（不许 contains/startsWith）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('subtract');
    expect(res.body.operation).not.toBe('sub');
    expect(res.body.operation).not.toBe('subtraction');
    expect(res.body.operation).not.toBe('minus');
    expect(res.body.operation).not.toBe('diff');
  });

  test('GET /subtract?minuend=10&subtrahend=3 → 响应不含首要禁用字段（difference/diff/subtraction/sub_result/minus/delta）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    for (const k of ['difference', 'diff', 'subtraction', 'subtraction_result', 'sub_result', 'minus_result', 'minus', 'delta']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('GET /subtract?minuend=10&subtrahend=3 → 响应不含 generic 禁用字段（value/input/output/data/payload/answer/out/meta）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    for (const k of ['value', 'input', 'output', 'data', 'payload', 'response', 'answer', 'out', 'meta']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('GET /subtract?minuend=10&subtrahend=3 → 响应不含其他 endpoint 字段名（sum/product/quotient/power/remainder/factorial/negation）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '3' });
    expect(res.status).toBe(200);
    for (const k of ['sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  // ─── strict-schema 拒（10+ 类非法输入）────────────────────────

  test('GET /subtract?minuend=1e2&subtrahend=1 → 400（strict 拒科学计数法）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '1e2', subtrahend: '1' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /subtract?minuend=+5&subtrahend=3 → 400（strict 拒前导 +）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '+5', subtrahend: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=--5&subtrahend=3 → 400（strict 拒双重负号）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '--5', subtrahend: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=0xff&subtrahend=1 → 400（strict 拒十六进制）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '0xff', subtrahend: '1' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=1,000&subtrahend=1 → 400（strict 拒千分位）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '1,000', subtrahend: '1' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=1 0&subtrahend=1 → 400（strict 拒含空格）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '1 0', subtrahend: '1' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=&subtrahend=3 → 400（strict 拒空串）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '', subtrahend: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=abc&subtrahend=3 → 400（strict 拒字母）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: 'abc', subtrahend: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=Infinity&subtrahend=1 → 400（strict 拒 Infinity 字面）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: 'Infinity', subtrahend: '1' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=NaN&subtrahend=1 → 400（strict 拒 NaN 字面）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: 'NaN', subtrahend: '1' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=10&subtrahend=abc → 400（subtrahend 端同样校验）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: 'abc' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=10&subtrahend=1e2 → 400（subtrahend 端科学计数法拒）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', subtrahend: '1e2' });
    expect(res.status).toBe(400);
  });

  // ─── 缺参拒 ──────────────────────────────────────────────────

  test('GET /subtract?minuend=10 → 400（缺 subtrahend）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /subtract?subtrahend=3 → 400（缺 minuend）', async () => {
    const res = await request(app).get('/subtract').query({ subtrahend: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract → 400（双参都缺）', async () => {
    const res = await request(app).get('/subtract');
    expect(res.status).toBe(400);
  });

  // ─── 错 query 名拒（W22 强约束）───────────────────────────────

  test('GET /subtract?a=10&b=3 → 400（错 query 名 a/b，禁止偷懒复用）', async () => {
    const res = await request(app).get('/subtract').query({ a: '10', b: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?x=10&y=3 → 400（错 query 名 x/y）', async () => {
    const res = await request(app).get('/subtract').query({ x: '10', y: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?lhs=10&rhs=3 → 400（错 query 名 lhs/rhs）', async () => {
    const res = await request(app).get('/subtract').query({ lhs: '10', rhs: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?left=10&right=3 → 400（错 query 名 left/right）', async () => {
    const res = await request(app).get('/subtract').query({ left: '10', right: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?first=10&second=3 → 400（错 query 名 first/second）', async () => {
    const res = await request(app).get('/subtract').query({ first: '10', second: '3' });
    expect(res.status).toBe(400);
  });

  test('GET /subtract?minuend=10&b=3 → 400（半正半错 minuend+b 混合）', async () => {
    const res = await request(app).get('/subtract').query({ minuend: '10', b: '3' });
    expect(res.status).toBe(400);
  });

  // ─── 错误体 schema 完整性 ─────────────────────────────────────

  test('错误响应顶层 keys 字面集合 == ["error"]，且不含 result/operation', async () => {
    const res = await request(app).get('/subtract').query({ minuend: 'abc', subtrahend: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });
});

describe('回归 — 已有 8 路由不被破坏 [BEHAVIOR]', () => {
  test('GET /health → 200 + {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /multiply?a=2&b=3 → 200 + {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(6);
  });

  test('GET /divide?a=6&b=3 → 200 + {quotient:2}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(2);
  });

  test('GET /power?a=2&b=3 → 200 + {power:8}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(8);
  });

  test('GET /modulo?a=7&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('GET /increment?value=5 → 200 + {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /factorial?n=5 → 200 + {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });
});
