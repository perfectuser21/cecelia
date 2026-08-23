// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：orchestrator decision_log 时序 ↔ resolveValidationClock 有界顺延判死
//
// 本 sprint 冻结守卫（08231856-kernel-r57-validation-clock / r57）：真 import real validation-clock.js，
// 不 mock 被改模块（resolveValidationClock 及其内部 exactClock/persistedClock 全真跑）。
//
// bug（r57 修复目标 / r50·r51 案卷）：resolveValidationClock 的 pipeline deadline 永远锚定「首个」
//   generator 系 spawn（firstValidationOrigin 按 hop 排序取 [0]），从首原点起算固定 timeout_seconds。
//   fix 轮多的长跑 run（CI 红→fix→评→judge 循环 3+ 轮）在管线仍健康推进时就撞 deadline 被判死，
//   人工只能 psql 手改 pipeline_started_at/deadline_at 续命（r50/r51 两次手术实录）。
//
// 修复：每个 spawn:generator-fix 轮把 validation 窗口重锚到「最新」generator 系 spawn 行的 created_at
//   重新起算 timeout_seconds；顺延次数 = decisionLog 中 spawn:generator-fix 行数，上限 6 次，
//   超上限冻结在第 6 次顺延原点、到期照常判死（有界，防无限续命）。无 fix 轮时窗口语义完全不变。
//
// 纯函数可重放：顺延判定只依赖 decisionLog 行（hop 时序 + created_at），re-derive 新窗口，
//   不复用 fix 行上「一次顺延之前」的 stale persisted detail（B-01 用 stale detail 锁死该语义，
//   防 generator 用 persistedClock(fixRow) 实现导致锚点落后一次顺延）。
import { describe, it, expect } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const T0 = Date.parse('2026-08-01T00:00:00.000Z');
const iso = (offsetSeconds) => new Date(T0 + offsetSeconds * 1000).toISOString();

function genRow(hop, offsetSeconds, detail) {
  return {
    hop,
    action: 'spawn:generator',
    created_at: iso(offsetSeconds),
    ...(detail ? { detail } : {}),
  };
}
function fixRow(hop, offsetSeconds, detail) {
  return {
    hop,
    action: 'spawn:generator-fix',
    created_at: iso(offsetSeconds),
    ...(detail ? { detail } : {}),
  };
}

describe('resolveValidationClock 按 fix 轮有界顺延 [F1 step3]', () => {
  it('2 轮 generator-fix 后 deadline 顺延到最新 fix 原点的 created_at + timeout（RED→GREEN 核心，禁用 stale persisted detail）', () => {
    // 复刻 r50：run 已 2 轮 generator-fix；按首原点原窗口早已耗尽（fix2 在 T0+10000s，> T0+timeout）。
    // 最新 fix 行携带「一次顺延之前」的 stale persisted detail（锚在首原点 T0），
    // 纯函数必须 re-derive 到 fix2.created_at，而非复用 stale detail；intentAt 更晚（T0+12000）也不得被当原点。
    const decisionLog = [
      genRow(1, 0),
      fixRow(2, 5000),
      fixRow(3, 10000, { pipeline_started_at: iso(0), deadline_at: iso(TIMEOUT) }), // stale：锚在首原点
    ];
    const clock = resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog,
      intentAt: iso(12000),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: iso(10000),
      deadline_at: iso(10000 + TIMEOUT),
    });
  });

  it('顺延超上限：7 轮 generator-fix deadline 冻结在第 6 次顺延原点，第 7 次不再顺延', () => {
    const decisionLog = [genRow(1, 0)];
    for (let k = 1; k <= 7; k += 1) decisionLog.push(fixRow(1 + k, 1000 * k));
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: iso(9000),
      timeoutSeconds: TIMEOUT,
    });
    // 第 6 次 fix 在 T0+6000（第 7 次 T0+7000 被上限截断，不作原点）
    expect(clock.pipeline_started_at).toBe(iso(6000));
    expect(clock.deadline_at).toBe(iso(6000 + TIMEOUT));
    expect(clock.deadline_at).not.toBe(iso(7000 + TIMEOUT));
  });

  it('边界：恰好 6 轮 generator-fix 仍顺延到第 6 次原点（上限内不冻结）', () => {
    const decisionLog = [genRow(1, 0)];
    for (let k = 1; k <= 6; k += 1) decisionLog.push(fixRow(1 + k, 1000 * k));
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: iso(8000),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock.pipeline_started_at).toBe(iso(6000));
    expect(clock.deadline_at).toBe(iso(6000 + TIMEOUT));
  });

  it('无 generator-fix 行时窗口仍以首 generator 原点算（回归守恒，语义不变）', () => {
    const decisionLog = [genRow(1, 0)];
    const clock = resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog,
      intentAt: iso(3000),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
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
