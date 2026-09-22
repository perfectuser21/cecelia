/**
 * scheduler-jobs-openclaw-reaper.test.js — openclaw-agent 收割 job 必须真登记进 JOBS（PR3 Task 5）
 *
 * 只验注册表：没进 JOBS 的收割函数永远没人调，秋米任务会一直停在 in_progress
 * 直到合同 45min stale 被守护刀判 fail —— 等于「跑成功了也算失败」。
 */
import { describe, it, expect } from 'vitest';
import { JOBS } from '../scheduler-jobs.js';

describe('scheduler-jobs 登记 openclaw-agent-reaper', () => {
  it('存在、needsPool、handler 是函数', () => {
    const j = JOBS.find((x) => x.name === 'openclaw-agent-reaper');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(typeof j.handler).toBe('function');
  });
});
