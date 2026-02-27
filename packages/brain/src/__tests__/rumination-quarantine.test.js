/**
 * 测试反刍系统对隔离失败记录的处理
 */

import { describe, it, expect } from 'vitest';
import { buildRuminationPrompt } from '../rumination.js';

describe('反刍系统隔离模式检测', () => {
  const mockMemoryBlock = '相关记忆上下文';
  const mockNotebookContext = 'NotebookLM 补充知识';

  it('包含隔离失败记录时应追加分析指令', () => {
    const learnings = [
      {
        id: '1',
        title: '正常学习记录',
        content: '这是一个正常的学习记录',
        category: 'general'
      },
      {
        id: '2',
        title: '隔离分析：任务A失败',
        content: '这个任务失败是因为配置错误',
        category: 'quarantine_pattern'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, mockMemoryBlock, mockNotebookContext);

    // 验证包含隔离模式特殊指令
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');

    // 验证基本内容仍然存在
    expect(prompt).toContain('正常学习记录');
    expect(prompt).toContain('隔离分析：任务A失败');
    expect(prompt).toContain(mockMemoryBlock);
    expect(prompt).toContain(mockNotebookContext);
  });

  it('不包含隔离失败记录时prompt保持不变', () => {
    const learnings = [
      {
        id: '1',
        title: '正常学习记录',
        content: '这是一个正常的学习记录',
        category: 'general'
      },
      {
        id: '2',
        title: '另一个正常记录',
        content: '另一个正常的学习记录',
        category: 'development'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, mockMemoryBlock, mockNotebookContext);

    // 验证不包含隔离模式特殊指令
    expect(prompt).not.toContain('注意：其中含有隔离失败记录');
    expect(prompt).not.toContain('应如何避免同类失败');

    // 验证基本内容存在
    expect(prompt).toContain('正常学习记录');
    expect(prompt).toContain('另一个正常记录');
    expect(prompt).toContain('深度思考要求');
    expect(prompt).toContain('模式发现');
  });

  it('多个隔离记录应正确检测', () => {
    const learnings = [
      {
        id: '1',
        title: '隔离分析：任务A失败',
        content: '任务A失败分析',
        category: 'quarantine_pattern'
      },
      {
        id: '2',
        title: '隔离分析：任务B失败',
        content: '任务B失败分析',
        category: 'quarantine_pattern'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, mockMemoryBlock, mockNotebookContext);

    // 验证包含隔离模式特殊指令
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');

    // 验证包含所有隔离记录
    expect(prompt).toContain('隔离分析：任务A失败');
    expect(prompt).toContain('隔离分析：任务B失败');
  });

  it('空learnings数组应正常处理', () => {
    const learnings = [];

    const prompt = buildRuminationPrompt(learnings, mockMemoryBlock, mockNotebookContext);

    // 验证不包含隔离模式特殊指令
    expect(prompt).not.toContain('注意：其中含有隔离失败记录');

    // 验证基本结构存在
    expect(prompt).toContain('0 条知识进行深度分析');
    expect(prompt).toContain('深度思考要求');
  });

  it('无记忆上下文和NotebookLM上下文时应正常工作', () => {
    const learnings = [
      {
        id: '1',
        title: '隔离分析：测试任务',
        content: '测试任务失败分析',
        category: 'quarantine_pattern'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, null, null);

    // 验证包含隔离模式特殊指令
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');

    // 验证不包含可选的上下文部分
    expect(prompt).not.toContain('相关记忆上下文');
    expect(prompt).not.toContain('NotebookLM 补充知识');

    // 验证基本内容存在
    expect(prompt).toContain('隔离分析：测试任务');
    expect(prompt).toContain('深度思考要求');
  });

  it('category为undefined或null的记录应被忽略', () => {
    const learnings = [
      {
        id: '1',
        title: '无分类记录',
        content: '内容',
        category: undefined
      },
      {
        id: '2',
        title: '空分类记录',
        content: '内容',
        category: null
      },
      {
        id: '3',
        title: '隔离记录',
        content: '内容',
        category: 'quarantine_pattern'
      }
    ];

    const prompt = buildRuminationPrompt(learnings, null, null);

    // 验证包含隔离模式特殊指令（因为有一条隔离记录）
    expect(prompt).toContain('注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。');

    // 验证无分类记录显示为"未分类"
    expect(prompt).toContain('【未分类】无分类记录');
    expect(prompt).toContain('【未分类】空分类记录');
    expect(prompt).toContain('【quarantine_pattern】隔离记录');
  });
});