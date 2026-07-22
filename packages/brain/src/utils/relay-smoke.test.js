import { describe, it, expect } from 'vitest';
// CI 常跑副本（brain vitest include src/**/*.test.js 覆盖路径）。
// 用例名与语义与合同测试 sprints/07221126-relay-097e589d/tests/relay-smoke.test.ts 逐条一致。
import { formatSmokeStamp } from './relay-smoke.js';

describe('formatSmokeStamp [BEHAVIOR]', () => {
  it('标准输入返回 smoke:097e589d:20260722', () => {
    const out = formatSmokeStamp(
      '097e589d-ec53-4102-b8d1-9aa582b88ebd',
      new Date('2026-07-22T00:00:00Z')
    );
    expect(out).toBe('smoke:097e589d:20260722');
  });

  it('同输入两次调用输出一致（确定性）', () => {
    const a = formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'));
    const b = formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'));
    expect(a).toBe(b);
  });

  it('日期格式化按 UTC 取 YYYYMMDD 并零填充', () => {
    // UTC 2026-01-05：月/日均需零填充；非 UTC 实现（本地时区）在东八区会得到相同值，
    // 但在西半球时区会漂移到 20260104——因此断言值本身即锁定 UTC 语义。
    const out = formatSmokeStamp('abcd1234-0000-0000-0000-000000000000', new Date('2026-01-05T00:00:00Z'));
    expect(out).toBe('smoke:abcd1234:20260105');
  });

  it('taskId 不足 8 位时使用完整 taskId', () => {
    const out = formatSmokeStamp('abc', new Date('2026-07-22T00:00:00Z'));
    expect(out).toBe('smoke:abc:20260722');
  });

  it('空 taskId 抛 TypeError', () => {
    expect(() => formatSmokeStamp('', new Date('2026-07-22T00:00:00Z'))).toThrow(TypeError);
  });

  it('非字符串 taskId 抛 TypeError', () => {
    expect(() => formatSmokeStamp(12345678, new Date('2026-07-22T00:00:00Z'))).toThrow(TypeError);
  });

  it('Invalid Date 抛 TypeError', () => {
    expect(() => formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('not-a-date'))).toThrow(TypeError);
  });

  it('非 Date 参数抛 TypeError', () => {
    expect(() =>
      formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', '2026-07-22')
    ).toThrow(TypeError);
  });

  it('同进程多轮调用状态不重置输出确定', () => {
    // INV-1（铁律[测试设计]）：真实多轮、状态不重置——同进程内交错输入连续调用，
    // 每轮结果与首轮基准一致，证明函数无隐藏可变状态。
    const base1 = formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'));
    const base2 = formatSmokeStamp('deadbeef-0000-0000-0000-000000000000', new Date('2026-01-05T00:00:00Z'));
    for (let i = 0; i < 100; i++) {
      expect(formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'))).toBe(base1);
      expect(formatSmokeStamp('deadbeef-0000-0000-0000-000000000000', new Date('2026-01-05T00:00:00Z'))).toBe(base2);
    }
  });

  it('await 异步包装调用返回相同结果', async () => {
    // 铁律[测试质量]：lint-test-quality 要求 await fn() ≥1
    const out = await (async () =>
      formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z')))();
    expect(out).toBe('smoke:097e589d:20260722');
  });
});
