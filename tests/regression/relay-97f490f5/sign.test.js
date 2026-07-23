/**
 * Contract Test — GET /sign (playground 第 13 个端点)
 * Sprint: sprints/07231828-relay-97f490f5
 * Task ID: 97f490f5-d3d0-499c-835b-b4558406e9d1
 * target_environment: playground (vitest 单元测试)
 *
 * 覆盖 [BEHAVIOR-1..6] 全部判定点（DP-1..DP-13）
 */

import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

describe('GET /sign', () => {
  // ===== [BEHAVIOR-1] 正整数 → result:1 =====

  test('[B1/DP-1] value=5 → 200 + {result:1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B1] value=1 → 200 + {result:1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B1] value=100 → 200 + {result:1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B1/DP-4] value=9007199254740991 (MAX_SAFE_INTEGER) → 200 + {result:1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '9007199254740991' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('sign');
  });

  // ===== [BEHAVIOR-2] 零 → result:0 =====

  test('[B2/DP-2] value=0 → 200 + {result:0, operation:"sign"}（非 -0）', async () => {
    const res = await request(app).get('/sign').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    // 严格排除 -0：Object.is(result, 0) 必须为 true，Object.is(result, -0) 必须为 false
    expect(Object.is(res.body.result, 0)).toBe(true);
    expect(Object.is(res.body.result, -0)).toBe(false);
    expect(res.body.operation).toBe('sign');
    expect(res.body.result).not.toBe(1);
    expect(res.body.result).not.toBe(-1);
  });

  // ===== [BEHAVIOR-3] 负整数 → result:-1 =====

  test('[B3/DP-3] value=-3 → 200 + {result:-1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '-3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B3] value=-1 → 200 + {result:-1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B3] value=-100 → 200 + {result:-1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '-100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('sign');
  });

  test('[B3] value=-9007199254740991 (-MAX_SAFE_INTEGER) → 200 + {result:-1, operation:"sign"}', async () => {
    const res = await request(app).get('/sign').query({ value: '-9007199254740991' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('sign');
  });

  // ===== [BEHAVIOR-5/DP-9] 成功响应 schema 完整性 =====

  test('[B5/DP-9] 成功响应顶层 keys 排序后严格等于 ["operation","result"]', async () => {
    const res = await request(app).get('/sign').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('[B5/DP-11] result 字段值域约束：∈ {-1, 0, 1}', async () => {
    for (const [v, expected] of [['5', 1], ['-3', -1], ['0', 0]]) {
      const res = await request(app).get('/sign').query({ value: v });
      expect(res.status).toBe(200);
      expect([-1, 0, 1]).toContain(res.body.result);
      expect(res.body.result).toBe(expected);
    }
  });

  test('[B5/DP-11] result 字段类型为 number', async () => {
    const res = await request(app).get('/sign').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('number');
  });

  test('[B5/DP-13] 成功响应不含禁用同义字段', async () => {
    const res = await request(app).get('/sign').query({ value: '5' });
    expect(res.status).toBe(200);
    const forbidden = [
      'sign', 'signum', 'symbol', 'sgn', 'sig',
      'value', 'input', 'output', 'data', 'payload', 'answer', 'out', 'meta',
      'sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation',
      'increment', 'decrement',
    ];
    for (const k of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  // ===== [BEHAVIOR-6/DP-10] operation 字段字面值锁定 =====

  test('[B6/DP-10] operation 字段字面值严格 === "sign"', async () => {
    const res = await request(app).get('/sign').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('sign');
    expect(res.body.operation).not.toBe('signum');
    expect(res.body.operation).not.toBe('sgn');
    expect(res.body.operation).not.toBe('sign_function');
    expect(res.body.operation).not.toBe('Symbol');
    expect(res.body.operation).not.toBe('symbol');
  });

  // ===== [BEHAVIOR-4/DP-5] 超出 MAX_SAFE_INTEGER 拒 =====

  test('[B4/DP-5] value=9007199254740992 (MAX_SAFE_INTEGER+1) → 400 + error 非空', async () => {
    const res = await request(app).get('/sign').query({ value: '9007199254740992' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('[B4] value=99999999999999999999 (远超上界) → 400', async () => {
    const res = await request(app).get('/sign').query({ value: '99999999999999999999' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // ===== [BEHAVIOR-4/DP-6] value 缺失拒 =====

  test('[B4/DP-6] value 缺失（无 query）→ 400 + error 非空', async () => {
    const res = await request(app).get('/sign');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // ===== [BEHAVIOR-4/DP-7] 小数拒 =====

  test('[B4/DP-7] value=3.14 → 400（小数不匹配 ^-?\\d+$）', async () => {
    const res = await request(app).get('/sign').query({ value: '3.14' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  test('[B4] value=0.5 → 400（小数）', async () => {
    const res = await request(app).get('/sign').query({ value: '0.5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
  });

  // ===== [BEHAVIOR-4/DP-8] 字母串拒 =====

  test('[B4/DP-8] value=abc → 400（字母串）', async () => {
    const res = await request(app).get('/sign').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  // ===== [BEHAVIOR-4] 其他格式非法 =====

  test('[B4] value=1e3 → 400（科学计数法）', async () => {
    const res = await request(app).get('/sign').query({ value: '1e3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=+5 → 400（前导正号）', async () => {
    const res = await request(app).get('/sign').query({ value: '+5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value= → 400（空串）', async () => {
    const res = await request(app).get('/sign').query({ value: '' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=Infinity → 400', async () => {
    const res = await request(app).get('/sign').query({ value: 'Infinity' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=NaN → 400', async () => {
    const res = await request(app).get('/sign').query({ value: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=0xff → 400（十六进制）', async () => {
    const res = await request(app).get('/sign').query({ value: '0xff' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=1,000 → 400（千分位）', async () => {
    const res = await request(app).get('/sign').query({ value: '1,000' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=- → 400（仅负号无数字）', async () => {
    const res = await request(app).get('/sign').query({ value: '-' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[B4] value=--5 → 400（双重负号）', async () => {
    const res = await request(app).get('/sign').query({ value: '--5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // ===== [BEHAVIOR-4/DP-12] 错误响应 schema =====

  test('[B4/DP-12] 错误响应顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/sign').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  test('[B4/DP-12] 错误响应不含 result 字段', async () => {
    const res = await request(app).get('/sign').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  test('[B4/DP-12] 错误响应不含 operation 字段', async () => {
    const res = await request(app).get('/sign').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('[B4/DP-12] 错误响应不含 PRD 禁用替代错误名 message/msg/reason/detail', async () => {
    const res = await request(app).get('/sign').query({ value: 'abc' });
    expect(res.status).toBe(400);
    for (const k of ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});
