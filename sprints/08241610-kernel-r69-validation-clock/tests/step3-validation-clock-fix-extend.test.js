/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r69（issue: kernel validation clock 按 fix 轮有界顺延）：
 * resolveValidationClock 以「首个 spawn:generator intent」为固定原点，
 * deadline = pipeline_started_at + timeout_seconds（默认 5400s）。此后每个
 * spawn:generator-fix 都复用这条固定 deadline，导致 fix 轮多的长跑 run 在
 * 管线仍健康推进时撞死线被判 automation_deadline_exceeded，人工只能 psql
 * 手改 deadline 续命（r50/r51 手术实录）。
 *
 * 修复：每个「新出现在 decision-log 中的 spawn:generator-fix 行」成为新的
 * clock 原点，deadline 按该 fix 行的持久化时间重算 = fix 时间 + timeout_seconds；
 * 顺延有界，上限 6 次，第 7 次及以后的 fix 不再前移原点，deadline 停在第 6 个
 * fix 的锚点，超界后照常判死。纯函数：只依赖 decision-log 行 action + hop 时序
 * （+ 各行持久化时间），可重放逐字节相同。
 *
 * 禁 mock 被改的边：真 import 真 resolveValidationClock，传真实 decision-log
 * 行对象，禁 vi.mock 本模块、禁 stub persistedClock/exactClock 内部。
 *
 * 冻结测试落 sprints/08241610-kernel-r69-validation-clock/tests/（seal gate
 * requireTests 要求冻结测试必须在 sprint 目录下；根 vitest.config.js include
 * 含 sprints/**，CI 实跑不受影响）。r68 死因守卫：不在合同外目录建副本。
 */
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT_SECONDS = 5400; // 默认 5400s = 1.5h（本 sprint 不改默认值）

// 逐时构造 ISO 时间：2026-08-03Thh:00:00.000Z
const T = (h) => `2026-08-03T${String(h).padStart(2, '0')}:00:00.000Z`;
const plusTimeout = (iso) =>
  new Date(new Date(iso).getTime() + TIMEOUT_SECONDS * 1000).toISOString();

// 持久化行：detail 带一致的 pipeline_started_at / deadline_at（满足 persistedClock 重放不变量）
const genRow = (hop, at) => ({
  hop,
  action: 'spawn:generator',
  created_at: at,
  detail: { pipeline_started_at: at, deadline_at: plusTimeout(at) },
});
const fixRow = (hop, at) => ({
  hop,
  action: 'spawn:generator-fix',
  created_at: at,
  detail: { pipeline_started_at: at, deadline_at: plusTimeout(at) },
});

// gen @12:00 (deadline 13:30) → fix1 @13:00 → fix2 @14:00 → fix3 @15:00 ...（每轮相隔 1h，管线健康）
const GEN = genRow(10, T(12));
const FIX = (n) => fixRow(10 + n, T(12 + n)); // fixN @ (12+n):00

describe('resolveValidationClock — fix 轮有界顺延（r69）', () => {
  it('r50 复刻：3 个 generator-fix 后 deadline 前移到第 3 个 fix（旧逻辑判死→新逻辑存活）', () => {
    const decisionLog = [GEN, FIX(1), FIX(2), FIX(3)];
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: T(15),
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    // 新逻辑：锚在 fix3 @15:00 → deadline 16:30
    expect(clock.pipeline_started_at).toBe(T(15));
    expect(clock.deadline_at).toBe(plusTimeout(T(15))); // 2026-08-03T16:30:00.000Z
    // 存活断言：r50 现场 now=14:00 已过旧 deadline(13:30) 但未过新 deadline(16:30)
    const r50Now = new Date('2026-08-03T14:00:00.000Z');
    expect(new Date(clock.deadline_at).getTime() > r50Now.getTime()).toBe(true);
  });

  it('负向回归：0 个 fix 轮时语义与今日完全一致，deadline 锚在首个 generator', () => {
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [GEN],
      intentAt: T(13),
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    expect(clock.pipeline_started_at).toBe(T(12));
    expect(clock.deadline_at).toBe(plusTimeout(T(12))); // 13:30
  });

  it('恰好 6 个 fix 轮：deadline 锚在第 6 个 fix', () => {
    const decisionLog = [GEN, FIX(1), FIX(2), FIX(3), FIX(4), FIX(5), FIX(6)];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: T(18),
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    expect(clock.pipeline_started_at).toBe(T(18)); // fix6 @18:00
    expect(clock.deadline_at).toBe(plusTimeout(T(18))); // 19:30
  });

  it('负向：7+ fix 轮超界——deadline 停在第 6 个 fix，不再随第 7 个前移（超限判死）', () => {
    const decisionLog = [
      GEN, FIX(1), FIX(2), FIX(3), FIX(4), FIX(5), FIX(6), FIX(7),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: T(19),
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    // 有界：锚在 fix6 @18:00 → deadline 19:30，绝不前移到 fix7 @19:00（20:30）
    expect(clock.pipeline_started_at).toBe(T(18));
    expect(clock.deadline_at).toBe(plusTimeout(T(18)));
    expect(clock.deadline_at).not.toBe(plusTimeout(T(19))); // 不是 fix7 的 20:30
    // 超限判死：now=20:00 已过第 6 个 fix 的 deadline(19:30)
    const overNow = new Date('2026-08-03T20:00:00.000Z');
    expect(new Date(clock.deadline_at).getTime() < overNow.getTime()).toBe(true);
  });

  it('纯函数可重放：同一 decisionLog 多次解析逐字节相同', () => {
    const decisionLog = [GEN, FIX(1), FIX(2), FIX(3)];
    const a = resolveValidationClock({
      action: 'spawn:judge', decisionLog, intentAt: T(15), timeoutSeconds: TIMEOUT_SECONDS,
    });
    const b = resolveValidationClock({
      action: 'spawn:judge', decisionLog, intentAt: T(15), timeoutSeconds: TIMEOUT_SECONDS,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不变量：verified_existing_pr evaluator origin 路径不受顺延影响', () => {
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [{
        hop: 10,
        action: 'spawn:evaluator',
        created_at: T(12),
        detail: {
          validation_origin: 'verified_existing_pr',
          pipeline_started_at: T(12),
          deadline_at: plusTimeout(T(12)),
        },
      }],
      intentAt: T(13),
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    expect(clock.pipeline_started_at).toBe(T(12));
    expect(clock.deadline_at).toBe(plusTimeout(T(12)));
  });
});
