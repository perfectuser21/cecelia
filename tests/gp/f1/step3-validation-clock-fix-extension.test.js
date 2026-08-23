// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：orchestrator decision_log 时序 ↔
//   resolveValidationClock 有界顺延判死/续命（GP 产物闸守卫，决策 109dd8eb）。
//
// r57（run e243f543）：resolveValidationClock 原本 pipeline deadline 永远锚定「首个」
//   generator 系 spawn（firstValidationOrigin 取 [0]），fix 轮多的长跑 run 在管线仍健康
//   推进时就撞固定窗口被判死（r50/r51 人工 psql 续命）。修复：每轮 spawn:generator-fix 把
//   窗口重锚到「最新」generator 系 spawn 行 created_at 重算 timeout_seconds，顺延次数 =
//   spawn:generator-fix 行数、上限 6 次（超上限冻结第 6 次原点、到期照常判死，有界防无限续命）。
//
// 按产物闸规矩写在边上：真 import resolveValidationClock（不 vi.mock 被改模块），
//   构造真实 decision_log 行断言有界顺延语义。
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const T0 = Date.parse('2026-08-01T00:00:00.000Z');
const iso = (offsetSeconds) => new Date(T0 + offsetSeconds * 1000).toISOString();

const genRow = (hop, offsetSeconds, detail) => ({
  hop,
  action: 'spawn:generator',
  created_at: iso(offsetSeconds),
  ...(detail ? { detail } : {}),
});
const fixRow = (hop, offsetSeconds, detail) => ({
  hop,
  action: 'spawn:generator-fix',
  created_at: iso(offsetSeconds),
  ...(detail ? { detail } : {}),
});

describe('F1 step3 — resolveValidationClock 按 fix 轮有界顺延（GP 产物闸）', () => {
  it('2 轮 generator-fix 顺延到最新 fix 原点 created_at + timeout（忽略 stale persisted detail）', () => {
    const decisionLog = [
      genRow(1, 0),
      fixRow(2, 5000),
      fixRow(3, 10000, { pipeline_started_at: iso(0), deadline_at: iso(TIMEOUT) }),
    ];
    expect(resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog,
      intentAt: iso(12000),
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: iso(10000),
      deadline_at: iso(10000 + TIMEOUT),
    });
  });

  it('顺延超上限：7 轮 generator-fix 冻结在第 6 次顺延原点（防无限续命）', () => {
    const decisionLog = [genRow(1, 0)];
    for (let k = 1; k <= 7; k += 1) decisionLog.push(fixRow(1 + k, 1000 * k));
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: iso(9000),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock.pipeline_started_at).toBe(iso(6000));
    expect(clock.deadline_at).toBe(iso(6000 + TIMEOUT));
    expect(clock.deadline_at).not.toBe(iso(7000 + TIMEOUT));
  });

  it('边界：恰好 6 轮 generator-fix 仍顺延到第 6 次原点（上限内不冻结）', () => {
    const decisionLog = [genRow(1, 0)];
    for (let k = 1; k <= 6; k += 1) decisionLog.push(fixRow(1 + k, 1000 * k));
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: iso(8000),
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: iso(6000),
      deadline_at: iso(6000 + TIMEOUT),
    });
  });

  it('无 generator-fix 行时窗口仍以首 generator 原点算（回归守恒）', () => {
    expect(resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog: [genRow(1, 0)],
      intentAt: iso(3000),
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: iso(0),
      deadline_at: iso(TIMEOUT),
    });
  });

  it('fail-closed 守恒：非 generator 系且无有效 origin 仍抛 validation_clock_required', () => {
    expect(() => resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [],
      intentAt: iso(0),
      timeoutSeconds: TIMEOUT,
    })).toThrow('validation_clock_required');
  });
});
