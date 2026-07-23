/**
 * watchdog.test.js — watchdog 纯函数单元测试（配对 test，Sprint 1b997ed6）
 *
 * 主力行为测试在 watchdog-boundary.test.js。
 * 此文件覆盖 null/undefined 防御路径与模块导出完整性。
 */
import { describe, it, expect } from 'vitest';
import { watchdogShouldResume, watchdogAction } from '../watchdog.js';

describe('watchdog exports', () => {
  it('watchdogShouldResume: null run → false', () => {
    expect(watchdogShouldResume(null)).toBe(false);
  });

  it('watchdogShouldResume: undefined run → false', () => {
    expect(watchdogShouldResume(undefined)).toBe(false);
  });

  it('watchdogAction: expired run with no decisionLog → fenced_terminal_cleanup', () => {
    const result = watchdogAction(
      { phase: 'failed', terminal_reason: 'automation_deadline_exceeded' },
      null,
    );
    expect(result.action).toBe('fenced_terminal_cleanup');
    expect(result.reason).toBe('automation_deadline_exceeded');
  });

  it('watchdogAction: active run → check_resume', () => {
    const result = watchdogAction({ phase: 'generate', terminal_reason: null }, []);
    expect(result.action).toBe('check_resume');
  });
});
