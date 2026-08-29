import { describe, expect, it } from 'vitest';

import { detectSilentWaitStall, SILENT_WAIT_STALL_MS } from '../silent-wait.js';

const NOW = new Date('2026-08-29T08:00:00.000Z');
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe('detectSilentWaitStall', () => {
  it('阈值默认 15 分钟', () => {
    expect(SILENT_WAIT_STALL_MS).toBe(15 * 60 * 1000);
  });

  it('空日志 / 非数组 / 全无 created_at → 不判停摆（宁漏不误）', () => {
    for (const decisionLog of [[], null, undefined, [{ hop: 1, action: 'spawn:planner' }]]) {
      expect(detectSilentWaitStall({ decisionLog, now: NOW })).toEqual({
        stalled: false, idle_ms: null, last_hop: null, last_action: null, last_row_at: null,
      });
    }
  });

  it('最新行在阈值内 → 不停摆，但仍报告 idle 与最后一行', () => {
    const result = detectSilentWaitStall({
      decisionLog: [
        { hop: 3, action: 'spawn:judge', created_at: minutesAgo(40) },
        { hop: 4, action: 'effect:human_review_requested', created_at: minutesAgo(5) },
      ],
      now: NOW,
    });
    expect(result.stalled).toBe(false);
    expect(result.idle_ms).toBe(5 * 60_000);
    expect(result).toMatchObject({ last_hop: 4, last_action: 'effect:human_review_requested' });
  });

  it('最新行 ≥ 阈值 → 停摆；按 created_at 取最新而非按数组顺序', () => {
    const result = detectSilentWaitStall({
      decisionLog: [
        { hop: 9, action: 'effect:attempt_launched', created_at: minutesAgo(16) },
        { hop: 2, action: 'spawn:planner', created_at: minutesAgo(90) },
        { hop: 5, action: 'x', created_at: 'not-a-date' },
      ],
      now: NOW,
    });
    expect(result.stalled).toBe(true);
    expect(result).toMatchObject({ last_hop: 9, last_action: 'effect:attempt_launched' });
    expect(result.last_row_at).toBe(minutesAgo(16));
  });

  it('同一时刻多行取 hop 大者；接受 Date 与字符串 now；自定义阈值', () => {
    const at = minutesAgo(3);
    const result = detectSilentWaitStall({
      decisionLog: [
        { hop: 7, action: 'a', created_at: at },
        { hop: 8, action: 'b', created_at: new Date(at) },
      ],
      now: NOW.toISOString(),
      thresholdMs: 2 * 60_000,
    });
    expect(result).toMatchObject({ stalled: true, last_hop: 8, last_action: 'b' });
  });
});
