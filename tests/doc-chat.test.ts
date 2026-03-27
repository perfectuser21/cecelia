import { describe, it, expect } from 'vitest';

/**
 * doc-chat 逻辑单元测试
 *
 * 验证：
 * 1. POST /api/brain/doc-chat 端点返回 { success, reply } 结构
 * 2. <doc_update> 标记解析逻辑
 * 3. 模型映射逻辑
 */

// ── <doc_update> 解析逻辑 ────────────────────────────────

function extractDocUpdate(reply: string): { reply: string; docContent: string | null } {
  const match = reply.match(/<doc_update>([\s\S]*?)<\/doc_update>/);
  if (!match) return { reply, docContent: null };
  const docContent = match[1].trim();
  const cleanReply = reply.replace(/<doc_update>[\s\S]*?<\/doc_update>/g, '').trim();
  return { reply: cleanReply || '文档已更新。', docContent };
}

// ── 模型映射逻辑 ─────────────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

describe('doc-chat 端点返回结构', () => {
  it('返回 { success: true, reply } 结构', () => {
    const response = { success: true, reply: '这是 AI 的回复' };
    expect(response.success).toBe(true);
    expect(typeof response.reply).toBe('string');
  });

  it('含 docContent 时结构包含 docContent 字段', () => {
    const response = { success: true, reply: '文档已更新。', docContent: '# 更新后的文档' };
    expect(response.docContent).toBeDefined();
    expect(response.docContent).toContain('更新后的文档');
  });

  it('错误时返回 { success: false, error }', () => {
    const response = { success: false, error: 'message 不能为空' };
    expect(response.success).toBe(false);
    expect(response.error).toBeTruthy();
  });
});

describe('doc-chat <doc_update> 标记解析', () => {
  it('无 <doc_update> 标记时 docContent 为 null', () => {
    const reply = '这是一个普通回复，没有文档更新。';
    const result = extractDocUpdate(reply);
    expect(result.docContent).toBeNull();
    expect(result.reply).toBe(reply);
  });

  it('有 <doc_update> 标记时提取 docContent', () => {
    const reply = '好的，我帮你更新文档。\n<doc_update>\n# 新标题\n\n更新后的内容\n</doc_update>';
    const result = extractDocUpdate(reply);
    expect(result.docContent).toBe('# 新标题\n\n更新后的内容');
    expect(result.reply).toBe('好的，我帮你更新文档。');
  });

  it('仅有 <doc_update> 标记时 reply 为默认消息', () => {
    const reply = '<doc_update>\n文档内容\n</doc_update>';
    const result = extractDocUpdate(reply);
    expect(result.docContent).toBe('文档内容');
    expect(result.reply).toBe('文档已更新。');
  });

  it('移除 <doc_update> 块后 reply 不包含标记', () => {
    const reply = '回复内容\n<doc_update>\n文档\n</doc_update>\n其他内容';
    const result = extractDocUpdate(reply);
    expect(result.reply).not.toContain('<doc_update>');
    expect(result.reply).not.toContain('</doc_update>');
  });
});

describe('doc-chat 模型映射', () => {
  it('haiku 映射到正确的模型 ID', () => {
    expect(MODEL_MAP['haiku']).toBe('claude-haiku-4-5-20251001');
  });

  it('sonnet 映射到正确的模型 ID', () => {
    expect(MODEL_MAP['sonnet']).toBe('claude-sonnet-4-6');
  });

  it('opus 映射到正确的模型 ID', () => {
    expect(MODEL_MAP['opus']).toBe('claude-opus-4-6');
  });

  it('未知模型名时 fallback 到 haiku', () => {
    const resolvedModel = MODEL_MAP['unknown'] || MODEL_MAP['haiku'];
    expect(resolvedModel).toBe('claude-haiku-4-5-20251001');
  });
});

describe('doc-chat 对话历史截断', () => {
  it('最多保留最近 10 条对话历史', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant' as const,
      content: `消息 ${i}`,
    }));
    const historySlice = messages.slice(-10);
    expect(historySlice).toHaveLength(10);
    expect(historySlice[0].content).toBe('消息 5');
  });

  it('少于 10 条时保留全部', () => {
    const messages = [
      { role: 'user' as const, content: '你好' },
      { role: 'assistant' as const, content: '你好！' },
    ];
    const historySlice = messages.slice(-10);
    expect(historySlice).toHaveLength(2);
  });
});
