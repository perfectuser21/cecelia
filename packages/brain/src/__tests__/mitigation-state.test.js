import { describe, expect, it } from 'vitest';
import * as mitigation from '../alertness-actions.js';

describe('派发保护状态只读兼容接口', () => {
  it('返回状态副本，调用方改动不能改变后续派发读取', () => {
    const state1 = mitigation.getMitigationState();
    state1.p2_paused = true;

    const state2 = mitigation.getMitigationState();
    expect(state2.p2_paused).toBe(false);
  });

  it('公共模块仅保留现役派发读取接口，旧响应与状态写入口已退休', () => {
    expect(Object.keys(mitigation).sort()).toEqual(['default', 'getMitigationState']);
    expect(mitigation.default).toEqual({ getMitigationState: mitigation.getMitigationState });
    expect(mitigation.getMitigationState()).toEqual({ p2_paused: false, drain_mode_requested: false });
  });
});
