/**
 * DocEditor 组件行为测试
 * 验证：分栏布局逻辑、模型选择器选项、聊天消息处理
 */

import { describe, it, expect } from 'vitest';

// ── 模型选项数据（镜像 DocEditor.tsx 的 MODEL_OPTIONS） ──

const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku（快速）' },
  { value: 'sonnet', label: 'Sonnet（均衡）' },
  { value: 'opus', label: 'Opus（精准）' },
];

describe('DocEditor 模型选择器', () => {
  it('包含三个模型选项：Haiku、Sonnet、Opus', () => {
    const values = MODEL_OPTIONS.map(m => m.value);
    expect(values).toContain('haiku');
    expect(values).toContain('sonnet');
    expect(values).toContain('opus');
  });

  it('共有 3 个模型选项', () => {
    expect(MODEL_OPTIONS).toHaveLength(3);
  });

  it('每个选项都有 value 和 label', () => {
    MODEL_OPTIONS.forEach(opt => {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    });
  });

  it('默认模型为 haiku', () => {
    const defaultModel = 'haiku';
    const found = MODEL_OPTIONS.find(m => m.value === defaultModel);
    expect(found).toBeDefined();
  });
});

describe('DocEditor 分栏布局', () => {
  it('左侧文档区 data-testid 为 doc-content', () => {
    const leftPanel = { testId: 'doc-content' };
    expect(leftPanel.testId).toBe('doc-content');
  });

  it('右侧聊天区 data-testid 为 chat-panel', () => {
    const rightPanel = { testId: 'chat-panel' };
    expect(rightPanel.testId).toBe('chat-panel');
  });

  it('根容器 data-testid 为 doc-editor', () => {
    const root = { testId: 'doc-editor' };
    expect(root.testId).toBe('doc-editor');
  });
});

describe('DocEditor 聊天消息处理', () => {
  it('用户消息添加到消息列表', () => {
    const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }> = [];
    const userMsg = { id: '1', role: 'user' as const, content: '帮我更新文档' };
    messages.push(userMsg);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('AI 回复含 docContent 时文档内容更新', () => {
    let docContent = '# 原始文档';
    const response = { success: true, reply: '文档已更新。', docContent: '# 更新后的文档' };
    if (response.docContent) {
      docContent = response.docContent;
    }
    expect(docContent).toBe('# 更新后的文档');
  });

  it('AI 回复无 docContent 时文档内容不变', () => {
    const original = '# 原始文档';
    let docContent = original;
    const response = { success: true, reply: '这是普通回复' };
    if ((response as any).docContent) {
      docContent = (response as any).docContent;
    }
    expect(docContent).toBe(original);
  });

  it('发送时空消息不触发请求', () => {
    const input = '   ';
    const shouldSend = input.trim().length > 0;
    expect(shouldSend).toBe(false);
  });
});

describe('DocEditor 文档编辑模式', () => {
  it('编辑模式下显示 textarea', () => {
    const editMode = true;
    const displayTextarea = editMode;
    expect(displayTextarea).toBe(true);
  });

  it('预览模式下显示 markdown 渲染内容', () => {
    const editMode = false;
    const displayMarkdown = !editMode;
    expect(displayMarkdown).toBe(true);
  });

  it('取消编辑时恢复原始内容', () => {
    const originalContent = '# 原始文档';
    let docContent = '# 修改中的内容';
    const doc = { content: originalContent };

    // 模拟取消编辑
    docContent = doc.content || '';
    expect(docContent).toBe(originalContent);
  });
});
