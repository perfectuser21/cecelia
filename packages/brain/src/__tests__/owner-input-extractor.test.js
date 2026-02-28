import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock suggestion-triage.js 避免真实数据库连接
vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: vi.fn().mockResolvedValue({ id: 'sug-001', priority_score: 0.81 }),
}));

import { extractSuggestionsFromChat } from '../owner-input-extractor.js';
import { createSuggestion } from '../suggestion-triage.js';

describe('owner-input-extractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSuggestion.mockResolvedValue({ id: 'sug-001', priority_score: 0.81 });
  });

  // DOD-2: ACTION_INTENTS → createSuggestion 被触发
  describe('DOD-2: ACTION_INTENTS 触发 createSuggestion', () => {
    const actionIntents = [
      'CREATE_TASK',
      'CREATE_PROJECT',
      'CREATE_GOAL',
      'MODIFY',
      'LEARN',
      'RESEARCH',
      'COMMAND',
    ];

    actionIntents.forEach((intent) => {
      it(`${intent} 意图 → createSuggestion 被调用`, async () => {
        await extractSuggestionsFromChat('用户消息内容', intent);
        expect(createSuggestion).toHaveBeenCalledTimes(1);
      });
    });
  });

  // DOD-3: CHAT/QUERY_STATUS → 不创建 suggestion
  describe('DOD-3: 非动作意图不触发 createSuggestion', () => {
    const nonActionIntents = ['CHAT', 'QUERY_STATUS', 'UNKNOWN'];

    nonActionIntents.forEach((intent) => {
      it(`${intent} 意图 → createSuggestion 不被调用`, async () => {
        await extractSuggestionsFromChat('普通聊天消息', intent);
        expect(createSuggestion).not.toHaveBeenCalled();
      });
    });

    it('空 intentType → createSuggestion 不被调用', async () => {
      await extractSuggestionsFromChat('消息', '');
      expect(createSuggestion).not.toHaveBeenCalled();
    });

    it('空 message → createSuggestion 不被调用', async () => {
      await extractSuggestionsFromChat('', 'CREATE_TASK');
      expect(createSuggestion).not.toHaveBeenCalled();
    });
  });

  // DOD-4: suggestion source='owner_input', type='owner_request'
  describe('DOD-4: 参数验证 source + type', () => {
    it('createSuggestion 使用 source=owner_input', async () => {
      await extractSuggestionsFromChat('想做一个新任务', 'CREATE_TASK');
      expect(createSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'owner_input' })
      );
    });

    it('createSuggestion 使用 suggestion_type=owner_request', async () => {
      await extractSuggestionsFromChat('想做一个新任务', 'CREATE_TASK');
      expect(createSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ suggestion_type: 'owner_request' })
      );
    });

    it('createSuggestion 使用 agent_id=owner-input-extractor', async () => {
      await extractSuggestionsFromChat('想做一个新任务', 'CREATE_TASK');
      expect(createSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ agent_id: 'owner-input-extractor' })
      );
    });

    it('content 以 owner_request: 开头，截取前200字', async () => {
      const longMessage = 'A'.repeat(300);
      await extractSuggestionsFromChat(longMessage, 'COMMAND');
      const call = createSuggestion.mock.calls[0][0];
      expect(call.content).toMatch(/^owner_request: /);
      expect(call.content).toBe(`owner_request: ${'A'.repeat(200)}`);
    });

    it('metadata 包含 intent_type 和 original_length', async () => {
      const msg = '帮我创建一个 OKR';
      await extractSuggestionsFromChat(msg, 'CREATE_GOAL');
      expect(createSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            intent_type: 'CREATE_GOAL',
            original_length: msg.length,
          }),
        })
      );
    });
  });

  // DOD-5: 每次调用最多创建 1 个 suggestion（防洪峰）
  describe('DOD-5: 每次调用最多创建 1 个 suggestion', () => {
    it('单次调用 createSuggestion 恰好 1 次', async () => {
      await extractSuggestionsFromChat('想创建任务 A', 'CREATE_TASK');
      expect(createSuggestion).toHaveBeenCalledTimes(1);
    });

    it('createSuggestion 失败时不抛出错误（静默失败）', async () => {
      createSuggestion.mockRejectedValueOnce(new Error('DB error'));
      await expect(
        extractSuggestionsFromChat('测试消息', 'MODIFY')
      ).resolves.not.toThrow();
    });
  });
});
