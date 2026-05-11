import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

// Workstream 1 — GET /decrement TDD Red 阶段
// 期望红证据：playground/server.js 当前无 /decrement 路由 → Express 默认 404 → 所有断言 fail

describe('Workstream 1 — GET /decrement happy path [BEHAVIOR-类1-schema字段值]', () => {
  test('GET /decrement?value=5 → 200 + {result:4, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(4);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=0 → 200 + {result:-1, operation:"decrement"} (off-by-one 零侧)', async () => {
    const res = await request(app).get('/decrement').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=1 → 200 + {result:0, operation:"decrement"} (off-by-one 正一侧)', async () => {
    const res = await request(app).get('/decrement').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=-1 → 200 + {result:-2, operation:"decrement"} (off-by-one 负一侧)', async () => {
    const res = await request(app).get('/decrement').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=-5 → 200 + {result:-6, operation:"decrement"} (负数合法)', async () => {
    const res = await request(app).get('/decrement').query({ value: '-5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-6);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=100 → 200 + {result:99}', async () => {
    const res = await request(app).get('/decrement').query({ value: '100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(99);
  });

  test('GET /decrement?value=-100 → 200 + {result:-101}', async () => {
    const res = await request(app).get('/decrement').query({ value: '-100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-101);
  });

  test('GET /decrement?value=-9007199254740990 → 200 + {result:-9007199254740991} (精度下界 === -MAX_SAFE_INTEGER)', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740991);
    expect(res.body.result).toBe(-Number.MAX_SAFE_INTEGER);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=9007199254740990 → 200 + {result:9007199254740989} (精度上界 happy)', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740989);
  });
});

describe('Workstream 1 — GET /decrement schema 完整性 [BEHAVIOR-类2-schema完整性]', () => {
  test('成功响应顶层 keys 字面集合严格等于 ["operation","result"]', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('operation 字段字面值严格 === "decrement"（不许变体 dec/decr/decremented/prev/pred/sub_one/minus_one）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.body.operation).toBe('decrement');
    expect(res.body.operation).not.toBe('dec');
    expect(res.body.operation).not.toBe('decr');
    expect(res.body.operation).not.toBe('decremented');
    expect(res.body.operation).not.toBe('prev');
    expect(res.body.operation).not.toBe('predecessor');
    expect(res.body.operation).not.toBe('pred');
    expect(res.body.operation).not.toBe('sub_one');
    expect(res.body.operation).not.toBe('subtract_one');
    expect(res.body.operation).not.toBe('minus_one');
  });

  test('result 字段类型为 number（不许 string / BigInt）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(typeof res.body.result).toBe('number');
  });
});

describe('Workstream 1 — GET /decrement 禁用字段反向 [BEHAVIOR-类3-禁用字段反向]', () => {
  test('成功响应不含首要禁用字段 decremented/prev/previous/predecessor/n_minus_one/minus_one/sub_one/subtract_one/pred/dec/decr/decrementation/subtraction/difference', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    for (const k of [
      'decremented', 'prev', 'previous', 'predecessor',
      'n_minus_one', 'minus_one', 'sub_one', 'subtract_one',
      'pred', 'dec', 'decr', 'decrementation',
      'subtraction', 'difference',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('成功响应不含 generic 禁用字段 value/input/output/data/payload/response/answer/out/meta', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    for (const k of ['value', 'input', 'output', 'data', 'payload', 'response', 'answer', 'out', 'meta']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('成功响应不含其他 endpoint 字段名 sum/product/quotient/power/remainder/factorial/negation/incremented', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    for (const k of ['sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation', 'incremented']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});

describe('Workstream 1 — GET /decrement 下界拒 [BEHAVIOR-类4-error_path]', () => {
  test('GET /decrement?value=-9007199254740991 → 400 + error 非空 + 不含 result/operation', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  test('GET /decrement?value=-99999999999999999999 → 400 (远超下界)', async () => {
    const res = await request(app).get('/decrement').query({ value: '-99999999999999999999' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });
});

describe('Workstream 1 — GET /decrement 上界拒 [BEHAVIOR-类4-error_path]', () => {
  test('GET /decrement?value=9007199254740991 → 400 + 错误体 keys=["error"]', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  test('GET /decrement?value=99999999999999999999 → 400 (远超上界)', async () => {
    const res = await request(app).get('/decrement').query({ value: '99999999999999999999' });
    expect(res.status).toBe(400);
  });
});

describe('Workstream 1 — GET /decrement strict-schema 拒 [BEHAVIOR-类4-error_path]', () => {
  test('GET /decrement?value=1.5 → 400 (拒小数)', async () => {
    const res = await request(app).get('/decrement').query({ value: '1.5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=1.0 → 400 (拒小数点)', async () => {
    const res = await request(app).get('/decrement').query({ value: '1.0' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=1e2 → 400 (拒科学计数法)', async () => {
    const res = await request(app).get('/decrement').query({ value: '1e2' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=0xff → 400 (拒十六进制)', async () => {
    const res = await request(app).get('/decrement').query({ value: '0xff' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=+5 → 400 (拒前导 +)', async () => {
    const res = await request(app).get('/decrement').query({ value: '+5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=--5 → 400 (拒双重负号)', async () => {
    const res = await request(app).get('/decrement').query({ value: '--5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=5- → 400 (拒尾部负号)', async () => {
    const res = await request(app).get('/decrement').query({ value: '5-' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=abc → 400 (拒字母)', async () => {
    const res = await request(app).get('/decrement').query({ value: 'abc' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=Infinity → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: 'Infinity' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=NaN → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: 'NaN' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=- → 400 (仅负号无数字)', async () => {
    const res = await request(app).get('/decrement').query({ value: '-' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value= (空串) → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=1,000 → 400 (拒千分位)', async () => {
    const res = await request(app).get('/decrement').query({ value: '1,000' });
    expect(res.status).toBe(400);
  });
});

describe('Workstream 1 — GET /decrement 缺参 / 错 query 名拒 [BEHAVIOR-类4-error_path]', () => {
  test('GET /decrement (缺 value 参数) → 400', async () => {
    const res = await request(app).get('/decrement');
    expect(res.status).toBe(400);
  });

  test('GET /decrement?n=5 → 400 (错 query 名 n)', async () => {
    const res = await request(app).get('/decrement').query({ n: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?x=5 → 400 (错 query 名 x)', async () => {
    const res = await request(app).get('/decrement').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?a=5 → 400 (错 query 名 a)', async () => {
    const res = await request(app).get('/decrement').query({ a: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?val=5 → 400 (错 query 名 val)', async () => {
    const res = await request(app).get('/decrement').query({ val: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?input=5 → 400 (错 query 名 input)', async () => {
    const res = await request(app).get('/decrement').query({ input: '5' });
    expect(res.status).toBe(400);
  });
});

describe('Workstream 1 — GET /decrement 前导 0 happy (防八进制误解析) [BEHAVIOR]', () => {
  test('GET /decrement?value=01 → 200 + {result:0, operation:"decrement"} (不许 parseInt 八进制)', async () => {
    const res = await request(app).get('/decrement').query({ value: '01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=-01 → 200 + {result:-2, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '-01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });
});

describe('Workstream 1 — 已有 8 路由回归 [BEHAVIOR]', () => {
  test('GET /health 回归', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 回归', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /multiply?a=2&b=3 回归', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(6);
  });

  test('GET /divide?a=6&b=3 回归', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(2);
  });

  test('GET /power?a=2&b=3 回归', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(8);
  });

  test('GET /modulo?a=7&b=3 回归', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('GET /factorial?n=5 回归', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });

  test('GET /increment?value=5 回归', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });
});
