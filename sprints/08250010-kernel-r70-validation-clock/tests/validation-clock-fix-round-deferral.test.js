// 冻结契约测试（TDD RED）— validation clock 按 fix 轮自动顺延（有界）[r70]
//
// 真 import 被改文件，禁 mock 被改的边（resolveValidationClock 为纯函数，直调）。
// 语义（合同定义，generator 实现）：
//   - decisionLog 含 N 条 action='spawn:generator-fix' 行时，deadline 原点前移到
//     hop 时序中第 min(N,6) 条 generator-fix 行（顺延有界 6）；
//   - N==0 时语义与现状逐字节一致（首个 generator/verified_existing_pr 原点）；
//   - 只依赖入参 decision_log 的 action+hop，可重放；fail-closed 语义不削弱。
//
// 预期红证据：S1/S2/exactly6/order/interleaved/persist* 在 base 上返回旧原点(11:30)或不抛，
// 与断言不符 → FAIL；regression-nofix / failclosed / determinism 为回归护栏（base 亦绿）。
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400; // 默认 90 分钟，本 sprint 不改
const T_GEN = '2026-08-03T10:00:00.000Z';

// 生成 hop 递增、created_at 每小时递增的 fix 行
function fixRow(hop, iso) {
  return { hop, action: 'spawn:generator-fix', created_at: iso };
}
function hourIso(h) {
  return `2026-08-03T${String(h).padStart(2, '0')}:00:00.000Z`;
}

describe('resolveValidationClock — fix 轮顺延（有界）', () => {
  it('r50 replay: 两条 generator-fix 后 deadline 顺延到最后一条 fix 原点（旧判死新存活）', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      fixRow(20, '2026-08-03T11:00:00.000Z'),
      fixRow(30, '2026-08-03T12:00:00.000Z'),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 新原点 = 最后一条 fix(12:00) → deadline 13:30；旧逻辑会返回 11:30
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('bounded: 7 条 generator-fix 时 deadline 冻结在第 6 条 fix 原点（超限不再顺延）', () => {
    const decisionLog = [{ hop: 10, action: 'spawn:generator', created_at: T_GEN }];
    // 7 条 fix：hop 20..80，时间 11:00..17:00
    for (let i = 0; i < 7; i += 1) {
      decisionLog.push(fixRow(20 + i * 10, hourIso(11 + i)));
    }
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-03T18:00:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 第 6 条 fix = hop 70 = 16:00（非第 7 条 17:00）→ deadline 17:30
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T16:00:00.000Z',
      deadline_at: '2026-08-03T17:30:00.000Z',
    });
  });

  it('exactly 6: 恰好 6 条 generator-fix 时第 6 条顺延生效', () => {
    const decisionLog = [{ hop: 10, action: 'spawn:generator', created_at: T_GEN }];
    for (let i = 0; i < 6; i += 1) {
      decisionLog.push(fixRow(20 + i * 10, hourIso(11 + i)));
    }
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T17:00:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 第 6 条 fix = hop 70 = 16:00 → deadline 17:30
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T16:00:00.000Z',
      deadline_at: '2026-08-03T17:30:00.000Z',
    });
  });

  it('replay-order: 乱序 hop 传入按 hop 排序后取顺延原点', () => {
    // 与 r50 replay 相同的行，数组顺序打乱
    const decisionLog = [
      fixRow(30, '2026-08-03T12:00:00.000Z'),
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      fixRow(20, '2026-08-03T11:00:00.000Z'),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('interleaved: 仅 generator-fix 计入顺延计数，非 fix 行不计', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      { hop: 15, action: 'spawn:evaluator', created_at: '2026-08-03T10:30:00.000Z' },
      fixRow(20, '2026-08-03T11:00:00.000Z'),
      { hop: 25, action: 'spawn:judge', created_at: '2026-08-03T11:30:00.000Z' },
      fixRow(30, '2026-08-03T12:00:00.000Z'),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 只有 2 条 fix → 最后一条 12:00 → deadline 13:30
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('persisted-consistent: fix 原点 detail 自洽时复用 persistedClock', () => {
    // 最后一条 fix 携带自洽的持久化 clock（12:00 起算 5400s = 13:30）
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      {
        hop: 20,
        action: 'spawn:generator-fix',
        created_at: '2026-08-03T12:05:00.000Z',
        detail: {
          pipeline_started_at: '2026-08-03T12:00:00.000Z',
          deadline_at: '2026-08-03T13:30:00.000Z',
        },
      },
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('persisted-inconsistent: fix 原点 detail 不自洽时 fail-closed 抛 validation_clock_invalid', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      {
        hop: 20,
        action: 'spawn:generator-fix',
        created_at: '2026-08-03T12:05:00.000Z',
        detail: {
          pipeline_started_at: '2026-08-03T12:00:00.000Z',
          deadline_at: '2026-08-03T14:00:00.000Z', // 与 12:00+5400s(13:30) 不符
        },
      },
    ];
    expect(() => resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toThrow('validation_clock_invalid');
  });

  it('regression-nofix: 无 generator-fix 行时语义与现状逐字节一致', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      { hop: 15, action: 'spawn:reviewer', created_at: '2026-08-03T10:10:00.000Z' },
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T10:20:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 首个 generator 原点 10:00 → deadline 11:30（未顺延）
    expect(clock).toEqual({
      pipeline_started_at: T_GEN,
      deadline_at: '2026-08-03T11:30:00.000Z',
    });
  });

  it('invariant-failclosed: 缺原点仍 fail-closed 抛 validation_clock_required', () => {
    expect(() => resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [],
      intentAt: T_GEN,
      timeoutSeconds: TIMEOUT,
    })).toThrow('validation_clock_required');
  });

  it('determinism: 同一 decision_log 多次调用返回一致 deadline', () => {
    const decisionLog = [
      fixRow(30, '2026-08-03T12:00:00.000Z'),
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      fixRow(20, '2026-08-03T11:00:00.000Z'),
    ];
    const call = () => resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(call()).toEqual(call());
  });
});
