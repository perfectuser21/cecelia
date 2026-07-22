import { describe, it, expect } from 'vitest';
import { sessionDedupeKey, summarizeSession } from '../conversation-capture.js';

describe('sessionDedupeKey', () => {
  it('同一 session 生成稳定的 sha256 key', () => {
    const session = { source: 'conversation-claude', sessionId: 's1', lastEntryId: 'u2' };
    expect(sessionDedupeKey(session)).toBe(sessionDedupeKey(session));
    expect(sessionDedupeKey(session)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('suffix 不同（原始 vs 摘要）产生不同的 key', () => {
    const session = { source: 'conversation-claude', sessionId: 's1', lastEntryId: 'u2' };
    expect(sessionDedupeKey(session)).not.toBe(sessionDedupeKey(session, ':summary'));
  });

  it('lastEntryId 不同（复聊后再次闲置）产生相同的 key——只绑 sessionId，避免同一会话被当新会话重复摘要', () => {
    const before = { source: 'conversation-claude', sessionId: 's1', lastEntryId: 'u2' };
    const after = { source: 'conversation-claude', sessionId: 's1', lastEntryId: 'u5' };
    expect(sessionDedupeKey(before)).toBe(sessionDedupeKey(after));
  });

  it('source 不同（同一 sessionId 但不同工具，理论上不会发生，但函数本身要正确区分）产生不同的 key', () => {
    const claude = { source: 'conversation-claude', sessionId: 's1', lastEntryId: 'u1' };
    const codex = { source: 'conversation-codex', sessionId: 's1', lastEntryId: 'u1' };
    expect(sessionDedupeKey(claude)).not.toBe(sessionDedupeKey(codex));
  });
});

describe('summarizeSession', () => {
  it('LLM 返回合法 JSON topics 时，拼成编号列表文本', async () => {
    const fakeLlm = async () => ({ text: JSON.stringify({ topics: ['话题一', '话题二', '话题三'] }) });
    const result = await summarizeSession('原始内容', fakeLlm);
    expect(result).toBe('1. 话题一\n2. 话题二\n3. 话题三');
  });

  it('LLM 返回夹杂文字的 JSON 也能提取', async () => {
    const fakeLlm = async () => ({ text: '这是我的分析：\n{"topics": ["唯一话题"]}\n供参考' });
    const result = await summarizeSession('原始内容', fakeLlm);
    expect(result).toBe('1. 唯一话题');
  });

  it('LLM 返回空 topics 数组时返回 null', async () => {
    const fakeLlm = async () => ({ text: JSON.stringify({ topics: [] }) });
    const result = await summarizeSession('原始内容', fakeLlm);
    expect(result).toBeNull();
  });

  it('LLM 返回无法解析的文本时返回 null，不抛异常', async () => {
    const fakeLlm = async () => ({ text: '不是JSON也没有花括号' });
    await expect(summarizeSession('原始内容', fakeLlm)).resolves.toBeNull();
  });

  it('LLM 调用抛异常时返回 null，不向上抛出', async () => {
    const failingLlm = async () => { throw new Error('模拟LLM调用失败'); };
    await expect(summarizeSession('原始内容', failingLlm)).resolves.toBeNull();
  });

  it('topics 里的非字符串元素被过滤掉', async () => {
    const fakeLlm = async () => ({ text: JSON.stringify({ topics: ['正常话题', 123, null, '  ', '另一个话题'] }) });
    const result = await summarizeSession('原始内容', fakeLlm);
    expect(result).toBe('1. 正常话题\n2. 另一个话题');
  });
});
