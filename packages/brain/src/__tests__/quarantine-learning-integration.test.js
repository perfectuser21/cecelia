/**
 * 隔离学习功能集成测试
 * 测试隔离区和反刍系统的集成
 */

import { describe, it, expect } from 'vitest';
import { buildRuminationPrompt } from '../rumination.js';
import { QUARANTINE_REASONS, FAILURE_THRESHOLD } from '../quarantine.js';

describe('隔离学习系统集成测试', () => {
  it('应该正确导出隔离相关常量', () => {
    expect(QUARANTINE_REASONS.REPEATED_FAILURE).toBe('repeated_failure');
    expect(FAILURE_THRESHOLD).toBe(3);
  });

  it('buildRuminationPrompt 应该检测隔离模式', () => {
    const learnings = [
      {
        id: '1',
        title: '隔离分析：测试任务失败',
        content: '这个任务失败是因为配置错误',
        category: 'quarantine_pattern'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, null, null);

    // 验证包含隔离模式特殊指令
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');
    expect(prompt).toContain('隔离分析：测试任务失败');
  });

  it('buildRuminationPrompt 对正常learnings不应追加隔离指令', () => {
    const learnings = [
      {
        id: '1',
        title: '正常学习记录',
        content: '这是一个正常的学习记录',
        category: 'general'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, null, null);

    // 验证不包含隔离模式特殊指令
    expect(prompt).not.toContain('注意：其中含有隔离失败记录');
    expect(prompt).not.toContain('应如何避免同类失败');
  });

  it('quarantine.js 应该包含失败学习相关的导入', async () => {
    // 测试通过动态导入验证代码结构
    const quarantineModule = await import('../quarantine.js');

    // 验证主要函数存在
    expect(typeof quarantineModule.quarantineTask).toBe('function');
    expect(typeof quarantineModule.QUARANTINE_REASONS).toBe('object');
    expect(typeof quarantineModule.FAILURE_THRESHOLD).toBe('number');
  });

  it('混合learnings应正确检测隔离模式', () => {
    const learnings = [
      {
        id: '1',
        title: '正常记录1',
        content: '正常内容',
        category: 'general'
      },
      {
        id: '2',
        title: '隔离分析：任务X',
        content: '失败分析',
        category: 'quarantine_pattern'
      },
      {
        id: '3',
        title: '正常记录2',
        content: '正常内容',
        category: 'development'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, null, null);

    // 验证包含隔离模式特殊指令（因为有隔离记录）
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');

    // 验证包含所有记录
    expect(prompt).toContain('正常记录1');
    expect(prompt).toContain('隔离分析：任务X');
    expect(prompt).toContain('正常记录2');
  });
});