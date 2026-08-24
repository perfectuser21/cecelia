// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：validation clock 判死判活 ↔ fix 轮顺延
//
// r50/r51 手术实录：fix 轮多的 run 在管线仍健康推进时撞死线被判死，人工只能 psql
// 续命。本步骤守卫落在 resolveValidationClock 的原点选点边上：decision_log 含 N 条
// spawn:generator-fix 行时以第 min(N,6) 条 fix 为新原点顺延 deadline（有界 6），
// 超限照常判死，无 fix 行时语义逐字节不变。
//
// 真 import 被改模块（validation-clock.js），禁 mock 被改的边（纯函数直调）。
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400; // 默认 90 分钟

describe('F1 step3 — validation clock 按 fix 轮自动顺延（有界）', () => {
  it('r50 replay: 2 条 generator-fix 后 deadline 顺延到最后一条 fix 原点（旧判死新存活）', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: '2026-08-03T10:00:00.000Z' },
      { hop: 20, action: 'spawn:generator-fix', created_at: '2026-08-03T11:00:00.000Z' },
      { hop: 30, action: 'spawn:generator-fix', created_at: '2026-08-03T12:00:00.000Z' },
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 新原点 = 最后一条 fix(12:00) → deadline 13:30；旧逻辑返回 11:30
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('bounded: 7 条 generator-fix 时 deadline 冻结在第 6 条 fix 原点（超限不再顺延）', () => {
    const decisionLog = [{ hop: 10, action: 'spawn:generator', created_at: '2026-08-03T10:00:00.000Z' }];
    for (let i = 0; i < 7; i += 1) {
      decisionLog.push({
        hop: 20 + i * 10,
        action: 'spawn:generator-fix',
        created_at: `2026-08-03T${String(11 + i).padStart(2, '0')}:00:00.000Z`,
      });
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

  it('regression-nofix: 无 generator-fix 行时 deadline 与现状逐字节一致', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [{ hop: 10, action: 'spawn:generator', created_at: '2026-08-03T10:00:00.000Z' }],
      intentAt: '2026-08-03T10:20:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 首个 generator 原点 10:00 → deadline 11:30（未顺延）
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-03T10:00:00.000Z',
      deadline_at: '2026-08-03T11:30:00.000Z',
    });
  });
});
