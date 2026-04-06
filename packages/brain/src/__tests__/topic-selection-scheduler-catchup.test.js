/**
 * topic-selection-scheduler-catchup.test.js
 *
 * 验证 isInTriggerWindow 的 catch-up 窗口逻辑：
 * - 主窗口（UTC 01:00-01:05）触发
 * - catch-up 窗口（UTC 01:05-20:00）触发
 * - 窗口外（UTC 00:xx, 20:xx）不触发
 */

import { describe, it, expect, vi } from 'vitest';

// mock DB 依赖链，让 topic-selection-scheduler 可以在纯 JS 环境导入
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../topic-selector.js', () => ({ generateTopics: vi.fn() }));
vi.mock('../topic-suggestion-manager.js', () => ({ saveSuggestions: vi.fn() }));

import { isInTriggerWindow } from '../topic-selection-scheduler.js';

function utcDate(hour, minute = 0) {
  const d = new Date('2026-04-06T00:00:00Z');
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

describe('isInTriggerWindow', () => {
  it('主窗口 01:00 UTC 触发', () => {
    expect(isInTriggerWindow(utcDate(1, 0))).toBe(true);
  });

  it('主窗口 01:04 UTC 触发', () => {
    expect(isInTriggerWindow(utcDate(1, 4))).toBe(true);
  });

  it('主窗口结束后 01:05 UTC catch-up 触发', () => {
    expect(isInTriggerWindow(utcDate(1, 5))).toBe(true);
  });

  it('catch-up 窗口 10:00 UTC 触发', () => {
    expect(isInTriggerWindow(utcDate(10, 0))).toBe(true);
  });

  it('catch-up 窗口 19:59 UTC 触发', () => {
    expect(isInTriggerWindow(utcDate(19, 59))).toBe(true);
  });

  it('窗口外 00:59 UTC 不触发', () => {
    expect(isInTriggerWindow(utcDate(0, 59))).toBe(false);
  });

  it('窗口外 20:00 UTC 不触发', () => {
    expect(isInTriggerWindow(utcDate(20, 0))).toBe(false);
  });

  it('窗口外 23:00 UTC 不触发', () => {
    expect(isInTriggerWindow(utcDate(23, 0))).toBe(false);
  });
});
