import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('GET /decrement [BEHAVIOR]', () => {
  // === happy 主路径 + schema 完整性 ===
  it('value=5 → 200 + {result:4, operation:"decrement"} + 顶层 keys 字面集合 == [operation,result]', async () => {
    const res = await request(app).get('/decrement?value=5');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(4);
    expect(res.body.operation).toBe('decrement');
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  // === W26 模板漏改防御（W31 最易踩坑） ===
  it('value=5 响应 operation 字面严等 "decrement"，绝不是 "increment"（防 W26 模板漏改）', async () => {
    const res = await request(app).get('/decrement?value=5');
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('decrement');
    expect(res.body.operation).not.toBe('increment');
    expect(res.body.operation).not.toBe('inc');
    expect(res.body.operation).not.toBe('dec');
    expect(res.body.operation).not.toBe('subtract');
    expect(res.body.operation).not.toBe('minus_one');
  });

  // === off-by-one 三连断言 ===
  it('value=0 → result==-1（off-by-one 零侧，不被当 falsy 漏返）', async () => {
    const res = await request(app).get('/decrement?value=0');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.operation).toBe('decrement');
  });

  it('value=1 → result==0（off-by-one；严格 0 数字字面，非 null/undefined/false）', async () => {
    const res = await request(app).get('/decrement?value=1');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.result).not.toBeNull();
    expect(res.body.result).not.toBeUndefined();
  });

  it('value=-1 → result==-2（off-by-one 负侧）', async () => {
    const res = await request(app).get('/decrement?value=-1');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });

  // === 正负数 happy ===
  it('value=5 → result==4', async () => {
    const res = await request(app).get('/decrement?value=5');
    expect(res.body.result).toBe(4);
  });
  it('value=-5 → result==-6', async () => {
    const res = await request(app).get('/decrement?value=-5');
    expect(res.body.result).toBe(-6);
  });
  it('value=100 → result==99', async () => {
    const res = await request(app).get('/decrement?value=100');
    expect(res.body.result).toBe(99);
  });
  it('value=-100 → result==-101', async () => {
    const res = await request(app).get('/decrement?value=-100');
    expect(res.body.result).toBe(-101);
  });

  // === 精度上下界 happy（核心边界） ===
  it('value=9007199254740990（精度上界）→ result==9007199254740989（精确无浮点损失）', async () => {
    const res = await request(app).get('/decrement?value=9007199254740990');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740989);
    expect(res.body.operation).toBe('decrement');
  });

  it('value=-9007199254740990（精度下界）→ result==-9007199254740991 === Number.MIN_SAFE_INTEGER', async () => {
    const res = await request(app).get('/decrement?value=-9007199254740990');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740991);
    expect(res.body.result).toBe(Number.MIN_SAFE_INTEGER);
    expect(res.body.operation).toBe('decrement');
  });

  // === 上下界拒 ===
  it('value=9007199254740991 → 400（上界 +1 拒），错误体 keys==["error"]，不含 result/operation', async () => {
    const res = await request(app).get('/decrement?value=9007199254740991');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  it('value=-9007199254740991 → 400（下界 -1 拒）', async () => {
    const res = await request(app).get('/decrement?value=-9007199254740991');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  it('value=99999999999999999999 → 400（远超上界拒）', async () => {
    const res = await request(app).get('/decrement?value=99999999999999999999');
    expect(res.status).toBe(400);
  });

  // === strict-schema 拒（13 类） ===
  it.each([
    ['1.5', '小数'],
    ['1.0', '带小数点的整数'],
    ['1e2', '科学计数法'],
    ['0xff', '十六进制'],
    ['abc', '字母串'],
    ['Infinity', 'Infinity 字面'],
    ['NaN', 'NaN 字面'],
    ['', '空串'],
    ['-', '仅负号无数字'],
    ['--5', '双重负号'],
    ['+5', '前导 + 号'],
    ['1,000', '千分位逗号'],
    ['5-', '尾部负号'],
  ])('value=%s → 400（strict 拒：%s）', async (input) => {
    const res = await request(app).get('/decrement').query({ value: input });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  // === 缺参 / 错 query 名 / 多余 query ===
  it('GET /decrement（缺 value） → 400', async () => {
    const res = await request(app).get('/decrement');
    expect(res.status).toBe(400);
  });

  it.each(['n', 'x', 'y', 'm', 'k', 'val', 'num', 'input', 'v', 'a', 'b', 'count', 'size'])(
    '错 query 名 ?%s=5 → 400',
    async (badName) => {
      const res = await request(app).get('/decrement').query({ [badName]: '5' });
      expect(res.status).toBe(400);
    },
  );

  it('多余 query ?value=5&extra=x → 400 + 错误体不含 result/operation', async () => {
    const res = await request(app).get('/decrement?value=5&extra=x');
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  // === 前导 0 happy（非八进制） ===
  it('value=01 → 200 + result==0（前导 0 happy，非八进制 parseInt(_,8) 错位）', async () => {
    const res = await request(app).get('/decrement?value=01');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('decrement');
  });

  it('value=-01 → 200 + result==-2', async () => {
    const res = await request(app).get('/decrement?value=-01');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });

  // === 禁用响应字段反向（PR-G 死规则核心） ===
  it('response 不含任一禁用字段名（30+ 个）', async () => {
    const res = await request(app).get('/decrement?value=5');
    expect(res.status).toBe(200);
    const forbidden = [
      'decremented', 'prev', 'previous', 'predecessor', 'pred',
      'n_minus_one', 'minus_one', 'sub_one', 'subtracted', 'sub',
      'dec', 'decr', 'decrementation',
      'incremented', 'n_plus_one', 'successor',
      'value', 'input', 'output', 'data', 'payload', 'response',
      'answer', 'out', 'meta',
      'sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation',
    ];
    for (const k of forbidden) {
      expect(res.body).not.toHaveProperty(k);
    }
  });

  // === 8 路由回归 ===
  it('回归：/health happy', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ ok: true });
  });
  it('回归：/sum happy', async () => {
    const res = await request(app).get('/sum?a=2&b=3');
    expect(res.body.sum).toBe(5);
  });
  it('回归：/multiply happy', async () => {
    const res = await request(app).get('/multiply?a=2&b=3');
    expect(res.body.product).toBe(6);
  });
  it('回归：/divide happy', async () => {
    const res = await request(app).get('/divide?a=6&b=3');
    expect(res.body.quotient).toBe(2);
  });
  it('回归：/power happy', async () => {
    const res = await request(app).get('/power?a=2&b=3');
    expect(res.body.power).toBe(8);
  });
  it('回归：/modulo happy', async () => {
    const res = await request(app).get('/modulo?a=7&b=3');
    expect(res.body.remainder).toBe(1);
  });
  it('回归：/factorial happy', async () => {
    const res = await request(app).get('/factorial?n=5');
    expect(res.body.factorial).toBe(120);
  });
  it('回归：/increment happy（W26 字面 operation:"increment" 不被破坏）', async () => {
    const res = await request(app).get('/increment?value=5');
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });
});
