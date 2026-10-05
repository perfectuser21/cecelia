/**
 * 读回断言求值（树+仓库 v3.0 第 4 刀，路 B）：Step 的 readback.expect（==、>=、<=、!=、>、<、not_null_all）
 * 对一次真实运行里 Step span 报上来的 observed 求值。拿不到观测值/没有可比的期望一律「未知」，绝不猜 pass。
 */
import { describe, it, expect } from 'vitest';
import { evaluateReadback } from '../step-readback-eval.js';

const rb = (expect, type = 'metric') => ({ type, ref: 'metrics.x', expect });

describe('evaluateReadback', () => {
  it('== / != / >= / <= / > / < 数值比较', () => {
    expect(evaluateReadback(rb({ op: '==', value: 1 }), 1).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '==', value: 1 }), '1').verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '==', value: 1 }), 0).verdict).toBe('fail');
    expect(evaluateReadback(rb({ op: '!=', value: 0 }), 3).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '>=', value: 2 }), 2).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '>=', value: 2 }), 1).verdict).toBe('fail');
    expect(evaluateReadback(rb({ op: '<=', value: 0 }), 0).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '<=', value: 0 }), 4).verdict).toBe('fail');
    expect(evaluateReadback(rb({ op: '>', value: 0 }), 1).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: '<', value: 5 }), 5).verdict).toBe('fail');
  });

  it('观测值可以是 {value}，也可以是裸值；失败带原因', () => {
    expect(evaluateReadback(rb({ op: '==', value: 1 }), { value: 1 }).verdict).toBe('pass');
    const r = evaluateReadback(rb({ op: '>=', value: 3 }), { value: 1 });
    expect(r).toMatchObject({ verdict: 'fail' });
    expect(r.reason).toMatch(/1.*>=.*3/);
  });

  it('not_null_all：数组/对象里没有 null 才算过', () => {
    expect(evaluateReadback(rb({ op: 'not_null_all' }), [1, 'a']).verdict).toBe('pass');
    expect(evaluateReadback(rb({ op: 'not_null_all' }), [1, null]).verdict).toBe('fail');
    expect(evaluateReadback(rb({ op: 'not_null_all' }), { a: 1, b: null }).verdict).toBe('fail');
  });

  it('不能比的一律未知：没读回/type=none/没期望/没观测/非数值比大小/不认识的运算符', () => {
    expect(evaluateReadback(null, 1)).toMatchObject({ verdict: 'unknown', reason: 'no_readback' });
    expect(evaluateReadback({ type: 'none' }, 1)).toMatchObject({ verdict: 'unknown', reason: 'no_readback' });
    expect(evaluateReadback({ type: 'log', regex: 'x' }, 1)).toMatchObject({ verdict: 'unknown', reason: 'no_expect' });
    expect(evaluateReadback(rb({ op: '==', value: 1 }), undefined)).toMatchObject({ verdict: 'unknown', reason: 'no_observation' });
    expect(evaluateReadback(rb({ op: '>=', value: 1 }), 'abc')).toMatchObject({ verdict: 'unknown', reason: 'not_numeric' });
    expect(evaluateReadback(rb({ op: 'regex', value: 1 }), 1)).toMatchObject({ verdict: 'unknown', reason: 'unsupported_op' });
  });
});
