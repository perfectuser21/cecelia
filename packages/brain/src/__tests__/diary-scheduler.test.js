import { describe, it, expect } from 'vitest';
import { shouldGenerateDiary, buildDiaryContent } from '../diary-scheduler.js';

describe('diary-scheduler', () => {
  describe('shouldGenerateDiary()', () => {
    it('UTC 15:00 返回 true', () => {
      const now = new Date('2026-04-12T15:00:00Z');
      expect(shouldGenerateDiary(now)).toBe(true);
    });

    it('UTC 15:01 （窗口内）返回 true', () => {
      const now = new Date('2026-04-12T15:01:00Z');
      expect(shouldGenerateDiary(now)).toBe(true);
    });

    it('UTC 15:02 （窗口外）返回 false', () => {
      const now = new Date('2026-04-12T15:02:00Z');
      expect(shouldGenerateDiary(now)).toBe(false);
    });

    it('UTC 09:00 不是触发时间，返回 false', () => {
      const now = new Date('2026-04-12T09:00:00Z');
      expect(shouldGenerateDiary(now)).toBe(false);
    });
  });

  describe('buildDiaryContent()', () => {
    const baseStats = {
      today: '2026-04-12',
      prs: 3,
      decisions: 5,
      completedTasks: 10,
      krProgress: [
        { title: 'KR3：管家闭环', progress: 87 },
        { title: 'KR1：系统稳定', progress: 100 },
      ],
      failedTasks: 0,
    };

    it('包含日期标题', () => {
      const content = buildDiaryContent(baseStats);
      expect(content).toContain('2026-04-12 管家日报');
    });

    it('包含今日数据板块', () => {
      const content = buildDiaryContent(baseStats);
      expect(content).toContain('PR 合并：3 个');
      expect(content).toContain('任务完成：10 个');
    });

    it('包含 KR 进度板块', () => {
      const content = buildDiaryContent(baseStats);
      expect(content).toContain('## KR 进度');
      expect(content).toContain('KR3：管家闭环');
      expect(content).toContain('87%');
    });

    it('包含进度条', () => {
      const content = buildDiaryContent(baseStats);
      expect(content).toMatch(/\[█+░*\]/);
    });

    it('无失败任务时显示正常', () => {
      const content = buildDiaryContent({ ...baseStats, failedTasks: 0 });
      expect(content).toContain('今日无失败');
    });

    it('有失败任务时显示告警', () => {
      const content = buildDiaryContent({ ...baseStats, failedTasks: 3 });
      expect(content).toContain('⚠️');
      expect(content).toContain('3 个');
    });

    it('krProgress 为空时显示暂无活跃 KR', () => {
      const content = buildDiaryContent({ ...baseStats, krProgress: [] });
      expect(content).toContain('暂无活跃 KR');
    });
  });
});
