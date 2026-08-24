// F1 step3 gp 冻结测试（TDD RED）— validation clock 按 fix 轮自动顺延（有界）[r70]
//
// gp-anchor / feature-has-smoke 闸必需产物（tests/gp/f1/step3-*.test.js）。
// 真 import 被改文件，禁 mock 被改的边。聚焦核心 RED：r50 顺延存活 + 有界冻结 + 无 fix 回归。
// 完整行为谱见 sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js。
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const T_GEN = '2026-08-03T10:00:00.000Z';

describe('step3: validation clock fix-round deferral', () => {
  it('r50 replay: deadline 顺延到最后一条 generator-fix 原点（旧判死新存活）', () => {
    const decisionLog = [
      { hop: 10, action: 'spawn:generator', created_at: T_GEN },
      { hop: 20, action: 'spawn:generator-fix', created_at: '2026-08-03T11:00:00.000Z' },
      { hop: 30, action: 'spawn:generator-fix', created_at: '2026-08-03T12:00:00.000Z' },
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T12:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-03T12:00:00.000Z',
      deadline_at: '2026-08-03T13:30:00.000Z',
    });
  });

  it('bounded: 超过 6 条 generator-fix 时 deadline 冻结在第 6 条原点', () => {
    const decisionLog = [{ hop: 10, action: 'spawn:generator', created_at: T_GEN }];
    for (let i = 0; i < 7; i += 1) {
      decisionLog.push({
        hop: 20 + i * 10,
        action: 'spawn:generator-fix',
        created_at: `2026-08-03T${String(11 + i).padStart(2, '0')}:00:00.000Z`,
      });
    }
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-03T18:00:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-03T16:00:00.000Z',
      deadline_at: '2026-08-03T17:30:00.000Z',
    });
  });

  it('regression-nofix: 无 generator-fix 行时结果与现状一致', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [{ hop: 10, action: 'spawn:generator', created_at: T_GEN }],
      intentAt: '2026-08-03T10:20:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: T_GEN,
      deadline_at: '2026-08-03T11:30:00.000Z',
    });
  });
});
