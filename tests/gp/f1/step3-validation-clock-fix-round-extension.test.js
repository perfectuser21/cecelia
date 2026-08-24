/**
 * F1 / kernel validation clock 按 fix 轮自动顺延（有界）[r68]
 *
 * 冻结回归测试（CI 常驻）——真 import packages/brain/src/orchestrator/validation-clock.js，
 * 禁 mock 被改的边。与 sprints/08241515-kernel-r68-validation-clock/tests/
 * validation-clock-fix-extension.test.ts 内容对齐（同一契约的 CI 常驻副本，PRD 要求置于 tests/gp/f1/）。
 *
 * 根因：resolveValidationClock 的 pipeline deadline 以最早 spawn:generator origin 固定 timeout_seconds，
 * fix 轮多的健康长跑 run 撞初始 deadline 被误杀（r50/r51 人工 psql 续命实录）。
 * 修复：deadline 原点随最近一次 generator-fix 顺延，上限 6 次，超限冻结照常判死。
 */
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const T0 = '2026-08-24T00:00:00.000Z';
const OLD_DEADLINE = '2026-08-24T01:30:00.000Z';
const BUGGY_T0_DETAIL = { pipeline_started_at: T0, deadline_at: OLD_DEADLINE };

function row(hop, action, createdAt, detail) {
  return { hop, action, created_at: createdAt, ...(detail !== undefined ? { detail } : {}) };
}

describe('resolveValidationClock — fix 轮自动顺延（有界）[BEHAVIOR]', () => {
  it('B-01 顺延：downstream 角色采纳最近一次 generator-fix 原点（复刻 r50 存活）', () => {
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      row(20, 'spawn:generator-fix', '2026-08-24T00:40:00.000Z', BUGGY_T0_DETAIL),
      row(30, 'spawn:generator-fix', '2026-08-24T01:20:00.000Z', BUGGY_T0_DETAIL),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-24T01:20:00.000Z',
      deadline_at: '2026-08-24T02:50:00.000Z',
    });
  });

  it('B-02 有界：fix 轮 > 6 时原点冻结在第 6 次 fix，deadline 不再增长（超限照常判死）', () => {
    const fixes = [
      '2026-08-24T00:10:00.000Z', '2026-08-24T00:20:00.000Z', '2026-08-24T00:30:00.000Z',
      '2026-08-24T00:40:00.000Z', '2026-08-24T00:50:00.000Z', '2026-08-24T01:00:00.000Z',
      '2026-08-24T01:10:00.000Z', '2026-08-24T01:20:00.000Z',
    ];
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      ...fixes.map((t, i) => row(20 + i * 10, 'spawn:generator-fix', t, BUGGY_T0_DETAIL)),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-24T01:00:00.000Z',
      deadline_at: '2026-08-24T02:30:00.000Z',
    });
    expect(clock.deadline_at).not.toBe('2026-08-24T02:50:00.000Z');
  });

  it('B-03 语义不变：无 fix 轮时 deadline 与旧逻辑逐字节一致', () => {
    const decisionLog = [row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL)];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T00:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: T0,
      deadline_at: OLD_DEADLINE,
    });
  });

  it('B-04 Invariant：existing-PR evaluator origin 复用路径不受 fix 顺延影响', () => {
    const decisionLog = [
      row(10, 'spawn:evaluator', T0, {
        validation_origin: 'verified_existing_pr',
        pipeline_started_at: T0,
        deadline_at: OLD_DEADLINE,
      }),
      row(20, 'spawn:generator-fix', '2026-08-24T01:20:00.000Z', BUGGY_T0_DETAIL),
    ];
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: T0,
      deadline_at: OLD_DEADLINE,
    });
  });

  it('B-05 恰好 6 轮 fix：原点采纳第 6 次 fix（边界，未超限）', () => {
    const fixes = [
      '2026-08-24T00:10:00.000Z', '2026-08-24T00:20:00.000Z', '2026-08-24T00:30:00.000Z',
      '2026-08-24T00:40:00.000Z', '2026-08-24T00:50:00.000Z', '2026-08-24T01:00:00.000Z',
    ];
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      ...fixes.map((t, i) => row(20 + i * 10, 'spawn:generator-fix', t, BUGGY_T0_DETAIL)),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-24T01:00:00.000Z',
      deadline_at: '2026-08-24T02:30:00.000Z',
    });
  });
});
