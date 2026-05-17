/**
 * C3: stuck-detector 活动信号测试
 *
 * 覆盖 hasRecentGitActivity / hasRecentCiActivity / hasRecentActivity 三个新函数。
 * 通过注入 execFn 模拟 git / gh CLI，不依赖真实环境。
 */
import { describe, it, expect } from 'vitest';
import {
  _hasRecentGitActivity,
  _hasRecentCiActivity,
  _hasRecentActivity,
} from '../pipeline-patrol.js';

describe('pipeline-patrol activity signals (C3)', () => {
  describe('hasRecentGitActivity', () => {
    it('本地 branch 最近有 commit → 返回 true', () => {
      const execFn = () => 'abc123deadbeef\n';
      expect(_hasRecentGitActivity('cp-test', 10, execFn)).toBe(true);
    });

    it('本地查不到但 origin 有 → 返回 true', () => {
      let callCount = 0;
      const execFn = (cmd) => {
        callCount++;
        if (callCount === 1) throw new Error('no local branch');
        if (cmd.includes('origin/cp-test')) return 'def456\n';
        return '';
      };
      expect(_hasRecentGitActivity('cp-test', 10, execFn)).toBe(true);
    });

    it('两边都无输出 → 返回 false', () => {
      const execFn = () => '';
      expect(_hasRecentGitActivity('cp-test', 10, execFn)).toBe(false);
    });

    it('空 branch → 返回 false', () => {
      const execFn = () => 'abc\n';
      expect(_hasRecentGitActivity('', 10, execFn)).toBe(false);
    });

    it('git 全部抛错 → 返回 false（不是 crash）', () => {
      const execFn = () => { throw new Error('git fail'); };
      expect(_hasRecentGitActivity('cp-test', 10, execFn)).toBe(false);
    });
  });

  describe('hasRecentCiActivity', () => {
    it('PR 有 check-run 在最近 10 分钟内完成 → 返回 true', () => {
      const recentIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const execFn = () => JSON.stringify({
        statusCheckRollup: [
          { completedAt: recentIso, startedAt: recentIso },
        ],
      });
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(true);
    });

    it('所有 check-run 都是很久以前的 → 返回 false', () => {
      const oldIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60min 前
      const execFn = () => JSON.stringify({
        statusCheckRollup: [
          { completedAt: oldIso, startedAt: oldIso },
        ],
      });
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(false);
    });

    it('空 statusCheckRollup → 返回 false', () => {
      const execFn = () => JSON.stringify({ statusCheckRollup: [] });
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(false);
    });

    it('gh 命令出错（无 PR 等）→ 返回 false', () => {
      const execFn = () => { throw new Error('no PR'); };
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(false);
    });

    it('空 branch → 返回 false', () => {
      const execFn = () => '{}';
      expect(_hasRecentCiActivity('', 10, execFn)).toBe(false);
    });

    it('非法 JSON → 返回 false（不 crash）', () => {
      const execFn = () => 'not json';
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(false);
    });

    it('只有 createdAt 字段且在窗口内 → 返回 true', () => {
      const recent = new Date(Date.now() - 1 * 60 * 1000).toISOString();
      const execFn = () => JSON.stringify({
        statusCheckRollup: [{ createdAt: recent }],
      });
      expect(_hasRecentCiActivity('cp-test', 10, execFn)).toBe(true);
    });
  });

  describe('hasRecentActivity', () => {
    it('有 CI 活动（mock）→ active=true', () => {
      const result = _hasRecentActivity('cp-test', 10, {
        gitFn: () => false,
        ciFn: () => true,
      });
      expect(result.active).toBe(true);
      expect(result.ci).toBe(true);
      expect(result.git).toBe(false);
    });

    it('有 git 活动（mock）→ active=true', () => {
      const result = _hasRecentActivity('cp-test', 10, {
        gitFn: () => true,
        ciFn: () => false,
      });
      expect(result.active).toBe(true);
      expect(result.git).toBe(true);
      expect(result.ci).toBe(false);
    });

    it('两者都无 → active=false（退化到旧时间判）', () => {
      const result = _hasRecentActivity('cp-test', 10, {
        gitFn: () => false,
        ciFn: () => false,
      });
      expect(result.active).toBe(false);
      expect(result.git).toBe(false);
      expect(result.ci).toBe(false);
    });

    it('branch 为空字符串 → 两个信号都 false，active=false', () => {
      // 用真实实现（不注入 mock），但 branch 为空会提前返回
      const result = _hasRecentActivity('', 10);
      expect(result.active).toBe(false);
      expect(result.git).toBe(false);
      expect(result.ci).toBe(false);
    });
  });
});
