import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock thalamus.js 避免真实数据库连接
const mockProcessEvent = vi.hoisted(() => vi.fn());

vi.mock('../thalamus.js', () => ({
  processEvent: mockProcessEvent,
  EVENT_TYPES: {
    OWNER_INTENT: 'owner_intent',
  },
}));

import { extractSuggestionsFromChat } from '../owner-input-extractor.js';

describe('owner-input-extractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockProcessEvent.mockResolvedValue({ level: 0, actions: [], rationale: 'ok', confidence: 0.9, safety: false });
  });

  // DOD-2: ACTION_INTENTS → processEvent(OWNER_INTENT) 被触发
  describe('DOD-2: ACTION_INTENTS 触发 processEvent', () => {
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
      it(`${intent} 意图 → processEvent 被调用`, async () => {
        await extractSuggestionsFromChat('用户消息内容', intent);
        expect(mockProcessEvent).toHaveBeenCalledTimes(1);
      });
    });
  });

  // DOD-3: CHAT/QUERY_STATUS → 不触发 processEvent
  describe('DOD-3: 非动作意图不触发 processEvent', () => {
    const nonActionIntents = ['CHAT', 'QUERY_STATUS', 'UNKNOWN'];

    nonActionIntents.forEach((intent) => {
      it(`${intent} 意图 → processEvent 不被调用`, async () => {
        await extractSuggestionsFromChat('普通聊天消息', intent);
        expect(mockProcessEvent).not.toHaveBeenCalled();
      });
    });

    it('空 intentType → processEvent 不被调用', async () => {
      await extractSuggestionsFromChat('消息', '');
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });

    it('空 message → processEvent 不被调用', async () => {
      await extractSuggestionsFromChat('', 'CREATE_TASK');
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });
  });

  // DOD-4: event 格式验证
  describe('DOD-4: OWNER_INTENT 事件格式', () => {
    it('event.type 为 owner_intent', async () => {
      await extractSuggestionsFromChat('想做一个新任务', 'CREATE_TASK');
      expect(mockProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'owner_intent' })
      );
    });

    it('event.intent_type 与入参一致', async () => {
      await extractSuggestionsFromChat('想做一个新任务', 'CREATE_TASK');
      expect(mockProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({ intent_type: 'CREATE_TASK' })
      );
    });

    it('event.message 包含用户消息', async () => {
      await extractSuggestionsFromChat('帮我创建 OKR', 'CREATE_GOAL');
      expect(mockProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('帮我创建 OKR') })
      );
    });

    it('超长消息截取到 500 字', async () => {
      const longMessage = 'A'.repeat(600);
      await extractSuggestionsFromChat(longMessage, 'COMMAND');
      const call = mockProcessEvent.mock.calls[0][0];
      expect(call.message.length).toBeLessThanOrEqual(500);
    });
  });

  // DOD-5: 每次调用最多触发 1 次 processEvent，失败静默
  describe('DOD-5: 每次调用最多触发 1 次，失败静默', () => {
    it('单次调用 processEvent 恰好 1 次', async () => {
      await extractSuggestionsFromChat('想创建任务 A', 'CREATE_TASK');
      expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    });

    it('processEvent 失败时不抛出错误（静默失败）', async () => {
      mockProcessEvent.mockRejectedValueOnce(new Error('thalamus error'));
      await expect(
        extractSuggestionsFromChat('测试消息', 'MODIFY')
      ).resolves.not.toThrow();
    });
  });
});
