import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

// 锚 hop 起点与各档 deadline（timeoutSeconds=7200s=2h）
const startedAt = '2026-08-03T19:02:13.199Z';
const baseDeadlineAt = '2026-08-03T21:02:13.199Z'; // started + 1*timeout（现行为 / 零 fix）
const oneFixDeadlineAt = '2026-08-03T23:02:13.199Z'; // started + 2*timeout（1 次 fix 顺延）
const twoFixDeadlineAt = '2026-08-04T01:02:13.199Z'; // started + 3*timeout（2 次 fix 顺延）
const timeoutSeconds = 7200;

function anchor(detailDeadline = baseDeadlineAt) {
  return {
    hop: 70,
    action: 'spawn:generator',
    created_at: startedAt,
    detail: { pipeline_started_at: startedAt, deadline_at: detailDeadline },
  };
}

function generatorFix(hop, at) {
  return { hop, action: 'spawn:generator-fix', created_at: at, detail: {} };
}

describe('resolveValidationClock multi-fix window extension', () => {
  it('extends the validation window by one timeout per generator-fix after the anchor hop', () => {
    const decisionLog = [
      anchor(),
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
      generatorFix(74, '2026-08-03T20:30:00.000Z'),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T21:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: twoFixDeadlineAt,
    });
  });

  it('extends the validation window by exactly one timeout for a single generator-fix', () => {
    const decisionLog = [
      anchor(),
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
    ];
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-03T20:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: oneFixDeadlineAt,
    });
  });

  it('tolerates a persisted anchor clock already advanced to the extended deadline', () => {
    // 恢复/在途 run：锚 detail 的 deadline_at 已被上一轮写成顺延后的值，
    // 不得因顺延而误判 validation_clock_invalid，仍返回与 fixCount 一致的顺延 deadline。
    const decisionLog = [
      anchor(twoFixDeadlineAt),
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
      generatorFix(74, '2026-08-03T20:30:00.000Z'),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T21:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: twoFixDeadlineAt,
    });
  });

  it('keeps the extended deadline finite and exactly linear for a bounded fix count', () => {
    // 有界运行铁律：fixCount 有界时 deadline = started + (1+fixCount)*timeout，
    // 精确线性、有限，不因顺延乘法溢出或无界增长。5 次 fix → started + 6*timeout（+12h）。
    const decisionLog = [
      anchor(),
      generatorFix(72, '2026-08-03T20:00:00.000Z'),
      generatorFix(74, '2026-08-03T20:30:00.000Z'),
      generatorFix(76, '2026-08-03T21:00:00.000Z'),
      generatorFix(78, '2026-08-03T21:30:00.000Z'),
      generatorFix(80, '2026-08-03T22:00:00.000Z'),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T22:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: '2026-08-04T07:02:13.199Z', // started + 6*timeout
    });
  });

  it('leaves the window byte-for-byte unchanged when no generator-fix follows the anchor', () => {
    // 零回归：fixCount=0 时 deadline == started + 1*timeout，与现行为逐字节一致。
    const decisionLog = [anchor()];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-03T19:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: baseDeadlineAt,
    });
  });
});
