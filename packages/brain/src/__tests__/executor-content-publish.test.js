/**
 * executor-content-publish.test.js
 *
 * DoD 映射：
 * - content_publish + platform=douyin → /douyin-publisher
 * - content_publish + platform=kuaishou → /kuaishou-publisher
 * - content_publish + platform=xiaohongshu → /xiaohongshu-publisher
 * - content_publish + platform=toutiao → /toutiao-publisher
 * - content_publish + platform=weibo → /weibo-publisher
 * - content_publish + platform=zhihu → /zhihu-publisher
 * - content_publish + platform=wechat → /wechat-publisher
 * - content_publish + platform=shipinhao → /shipinhao-publisher
 * - content_publish + unknown platform → /dev (fallback)
 * - content_publish + no platform → /dev (fallback)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' }
}));

describe('getSkillForTaskType: content_publish 平台路由', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  const cases = [
    ['douyin', '/douyin-publisher'],
    ['kuaishou', '/kuaishou-publisher'],
    ['xiaohongshu', '/xiaohongshu-publisher'],
    ['toutiao', '/toutiao-publisher'],
    ['weibo', '/weibo-publisher'],
    ['zhihu', '/zhihu-publisher'],
    ['wechat', '/wechat-publisher'],
    ['shipinhao', '/shipinhao-publisher'],
  ];

  for (const [platform, expectedSkill] of cases) {
    it(`platform=${platform} → ${expectedSkill}`, () => {
      const result = getSkillForTaskType('content_publish', { platform });
      expect(result).toBe(expectedSkill);
    });
  }

  it('未知 platform → /dev（fallback）', () => {
    const result = getSkillForTaskType('content_publish', { platform: 'unknown_platform' });
    expect(result).toBe('/dev');
  });

  it('无 platform → /dev（fallback）', () => {
    const result = getSkillForTaskType('content_publish', {});
    expect(result).toBe('/dev');
  });

  it('无 payload → /dev（fallback）', () => {
    const result = getSkillForTaskType('content_publish', null);
    expect(result).toBe('/dev');
  });
});
