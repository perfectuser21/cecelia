// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：kernel 派发 validation 角色 ↔ 验证窗时长计算
//
// 生产实证（r40/r46）：validation clock 锚定第一个 generator hop + timeout_seconds 后不再刷新。
// 一条 run 经历多轮 fix、LLM 时延吃光首窗后，kernel 仍派 evaluator，但 runner 的断言预算
// runner_assertion_budget_seconds = max(1, 负数) = 1 秒 → npm ci 秒杀 → 被伪装成 trusted
// 「assertion dependency install failed」→ judge 机械闸零测试假 FAIL，需 Commander 手工救活。
//
// 修法：resolveValidationClock 在锚 hop 之后每出现一次 spawn:generator-fix 即把窗口顺延一个
// timeoutSeconds（deadline = anchor_started + (1+fixCount)*timeout），断言预算恒为正。
//
// 按产物闸规矩写在边上：真 import resolveValidationClock（不 mock 被改模块）。
import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const startedAt = '2026-08-03T19:02:13.199Z';
const baseDeadlineAt = '2026-08-03T21:02:13.199Z'; // started + 1*timeout（零 fix）
const timeoutSeconds = 7200;

const anchor = (detailDeadline = baseDeadlineAt) => ({
  hop: 70,
  action: 'spawn:generator',
  created_at: startedAt,
  detail: { pipeline_started_at: startedAt, deadline_at: detailDeadline },
});
const generatorFix = (hop, at) => ({ hop, action: 'spawn:generator-fix', created_at: at, detail: {} });

const resolve = (decisionLog) => resolveValidationClock({
  action: 'spawn:evaluator',
  decisionLog,
  intentAt: '2026-08-03T21:30:00.000Z',
  timeoutSeconds,
});

describe('F1 step3：验证窗随 generator-fix 顺延，断言预算不再被钳到 1 秒', () => {
  it('多轮 fix 链：deadline = anchor_started + (1+fixCount)*timeout，且预算恒为正', () => {
    const decisionLog = [
      anchor(),
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
      generatorFix(74, '2026-08-03T20:30:00.000Z'),
    ];
    const clock = resolve(decisionLog);
    // 2 次 fix → started + 3*timeout
    expect(clock.deadline_at).toBe('2026-08-04T01:02:13.199Z');
    // 断言预算 = deadline - intentAt 必须为正（不再被钳到 1 秒）
    const budgetMs = new Date(clock.deadline_at).getTime() - new Date('2026-08-03T21:30:00.000Z').getTime();
    expect(budgetMs).toBeGreaterThan(0);
  });

  it('恢复/在途 run：锚 detail 已写成顺延后 deadline 时不误判 validation_clock_invalid', () => {
    const decisionLog = [
      anchor('2026-08-04T01:02:13.199Z'), // 上一轮已写成顺延后值
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
      generatorFix(74, '2026-08-03T20:30:00.000Z'),
    ];
    expect(() => resolve(decisionLog)).not.toThrow();
    expect(resolve(decisionLog).deadline_at).toBe('2026-08-04T01:02:13.199Z');
  });

  it('零回归：无 generator-fix 时窗口与现行为逐字节一致', () => {
    expect(resolve([anchor()]).deadline_at).toBe(baseDeadlineAt);
  });
});
