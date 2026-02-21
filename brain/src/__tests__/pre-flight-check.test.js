/**
 * Pre-flight Check Tests
 * Tests for task quality validation before dispatch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { preFlightCheck, getPreFlightStats } from '../pre-flight-check.js';

describe('preFlightCheck', () => {
  describe('title validation', () => {
    it('should fail for empty title', async () => {
      const task = { title: '', description: 'Valid description', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task title is empty');
    });

    it('should fail for short title (< 5 characters)', async () => {
      const task = { title: 'test', description: 'Valid description', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task title too short (< 5 characters)');
    });

    it('should pass for valid title', async () => {
      const task = { title: 'Implement feature X', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('description validation', () => {
    it('should fail for empty description', async () => {
      const task = { title: 'Valid Title', description: '', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task description is empty');
    });

    it('should fail for short description (< 20 characters)', async () => {
      const task = { title: 'Valid Title', description: 'short', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task description too short (< 20 characters)');
    });

    it('should fail for placeholder text', async () => {
      const task = { title: 'Valid Title', description: 'TODO: Add description later', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Description contains placeholder text');
    });

    it('should fail for generic descriptions', async () => {
      const task = { title: 'Valid Title', description: 'test', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Description is too generic');
    });

    it('should pass for valid description', async () => {
      const task = {
        title: 'Implement feature X',
        description: 'Add user authentication feature with JWT tokens',
        priority: 'P1'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('priority validation', () => {
    it('should fail for missing priority', async () => {
      const task = { title: 'Valid Title', description: 'Valid description' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Invalid priority: undefined');
    });

    it('should fail for invalid priority', async () => {
      const task = { title: 'Valid Title', description: 'Valid description', priority: 'P5' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Invalid priority: P5');
    });

    it('should pass for valid priority P0', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P0' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass for valid priority P1', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass for valid priority P2', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P2' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('skill validation', () => {
    it('should fail for unknown skill', async () => {
      const task = {
        title: 'Valid Title',
        description: 'Valid description',
        priority: 'P1',
        skill: '/unknown'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Unknown skill: /unknown');
    });

    it('should pass for valid skill /dev', async () => {
      const task = {
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        priority: 'P1',
        skill: '/dev'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass when skill is not specified', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('comprehensive validation', () => {
    it('should return multiple issues for invalid task', async () => {
      const task = {
        title: 'bad',
        description: 'x',
        priority: 'invalid'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(1);
      expect(result.suggestions.length).toBeGreaterThan(1);
    });

    it('should pass for fully valid task', async () => {
      const task = {
        title: 'Implement user authentication',
        description: 'Add JWT-based authentication with refresh tokens and secure session management',
        priority: 'P1',
        skill: '/dev'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });
  });
});

describe('placeholder detection — regression tests (D1/D2/D3)', () => {
  const base = { title: 'Valid Task Title', priority: 'P1' };

  // D1: 代码块内容在检测前被剥离
  it('D1: xxx in backtick inline code should NOT trigger', async () => {
    const task = {
      ...base,
      description: '实现以下格式：`- Task ID: xxx`，系统将根据此格式生成唯一任务标识。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D1: xxx in fenced code block should NOT trigger', async () => {
    const task = {
      ...base,
      // 注意：描述主体里没有 xxx，xxx 仅在代码块内
      description: '调用示例：\n```sql\nSELECT * FROM tasks WHERE id = xxx;\n```\n请根据实际任务情况填写对应 ID。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D1: todo inside backtick inline code should NOT trigger', async () => {
    const task = {
      ...base,
      description: '验证标准：每个 DoD 项有对应 PR，或在 `todo` 看板中有跟踪记录。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D1: TODO 记录 inside fenced code block should NOT trigger', async () => {
    const task = {
      ...base,
      description: '验收方式：\n```\n- 有对应 bugfix PR 或 TODO 记录\n- 测试覆盖率 ≥ 80%\n```\n确保以上均已完成。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  // D2: xxx 独立出现且前后均为 ASCII 时触发，前后紧接中文字符时不触发
  it('D2: xxx surrounded by ASCII spaces should still trigger', async () => {
    const task = {
      ...base,
      // xxx 前后是空格（ASCII），会被检测到
      description: 'Implementation plan: xxx - please fill in the actual plan details here.'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Description contains placeholder text');
  });

  it('D2: xxx directly surrounded by CJK characters should NOT trigger', async () => {
    const task = {
      ...base,
      // xxx 紧接中文字符（如 "ID进行xxx格式"），不视为 placeholder
      description: '系统需要对任务ID进行xxx格式校验，确保符合规范要求并通过所有单元测试。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  // D3: todo/tbd/fixme 用 \b 词边界匹配
  it('D3: bare "todo" as description should still trigger', async () => {
    const task = { ...base, description: 'todo: 完善后续描述内容，待讨论确定。' };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Description contains placeholder text');
  });

  it('D3: "tbd" in description should still trigger', async () => {
    const task = { ...base, description: '具体实现方案 tbd，待讨论后细化确认。' };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Description contains placeholder text');
  });

  it('D3: "fixme" in description should still trigger', async () => {
    const task = { ...base, description: 'fixme: 这里的逻辑有问题，需要修复并重新测试。' };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Description contains placeholder text');
  });

  it('D3: word containing "todo" as substring should NOT trigger', async () => {
    // e.g. "vtodo", "todolist" should not flag
    const task = {
      ...base,
      description: '参考 vtodo 协议规范，实现日历任务同步功能，确保与主流客户端兼容。'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain('Description contains placeholder text');
  });
});

describe('getPreFlightStats', () => {
  it('should return stats structure', async () => {
    // Mock pool for testing
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '5',
          passed_count: '95',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats).toHaveProperty('totalChecked');
    expect(stats).toHaveProperty('passed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('passRate');
    expect(stats).toHaveProperty('issueDistribution');
  });

  it('should calculate pass rate correctly', async () => {
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '20',
          passed_count: '80',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats.totalChecked).toBe(100);
    expect(stats.passed).toBe(80);
    expect(stats.failed).toBe(20);
    expect(stats.passRate).toBe('80.00%');
  });

  it('should handle zero checks gracefully', async () => {
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '0',
          passed_count: '0',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats.totalChecked).toBe(0);
    expect(stats.passRate).toBe('0%');
  });
});
