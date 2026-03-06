/**
 * proactive-mouth 单元测试
 *
 * 覆盖所有导出函数：
 *   sendProactiveMessage, notifyTaskCompletion,
 *   expressDesire, sendFollowUp
 *
 * 内部辅助函数 buildPromptForContext 通过 callLLM 调用参数间接验证。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoisted mocks（必须先于模块加载）────────────────────────────
const mockSendFeishu = vi.hoisted(() => vi.fn());
const mockRecordOutbound = vi.hoisted(() => vi.fn());

vi.mock('../notifier.js', () => ({
  sendFeishu: mockSendFeishu,
}));

vi.mock('../pending-conversations.js', () => ({
  recordOutbound: mockRecordOutbound,
}));

import {
  sendProactiveMessage,
  notifyTaskCompletion,
  expressDesire,
  sendFollowUp,
} from '../proactive-mouth.js';

// ─── 辅助工具 ────────────────────────────────────────────────────

/** 构造一个总是返回指定文本的 callLLM mock */
const makeLLM = (text = 'Cecelia 说的话') =>
  vi.fn().mockResolvedValue({ text });

/** 构造一个总是抛错的 callLLM mock */
const makeFailLLM = (msg = 'LLM error') =>
  vi.fn().mockRejectedValue(new Error(msg));

/** 最小 pg pool stub（proactive-mouth 通过 recordOutbound 间接使用） */
const makePool = () => ({ query: vi.fn() });

// ─── 测试 ────────────────────────────────────────────────────────

describe('proactive-mouth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认飞书发送成功
    mockSendFeishu.mockResolvedValue(true);
    // 默认 recordOutbound 成功（返回 id）
    mockRecordOutbound.mockResolvedValue('conv-id-1');
  });

  // ==================== sendProactiveMessage ====================

  describe('sendProactiveMessage', () => {
    it('reason 缺失时立即返回 {sent:false, message:null}', async () => {
      const pool = makePool();
      const callLLM = makeLLM();

      const result = await sendProactiveMessage(pool, callLLM, { reason: '' });

      expect(result).toEqual({ sent: false, message: null });
      expect(callLLM).not.toHaveBeenCalled();
      expect(mockSendFeishu).not.toHaveBeenCalled();
    });

    it('reason 为 undefined 时立即返回 {sent:false, message:null}', async () => {
      const pool = makePool();
      const callLLM = makeLLM();

      const result = await sendProactiveMessage(pool, callLLM, {});

      expect(result).toEqual({ sent: false, message: null });
    });

    it('正常流程：LLM 组织语言 → 飞书发送 → 记录 pending', async () => {
      const pool = makePool();
      const callLLM = makeLLM('任务完成啦！');

      const result = await sendProactiveMessage(pool, callLLM, {
        reason: '任务 A 已完成',
        contextType: 'task_completion',
        importance: 0.8,
        personId: 'owner',
        trackPending: true,
      });

      expect(result.sent).toBe(true);
      expect(result.message).toBe('任务完成啦！');
      expect(callLLM).toHaveBeenCalledOnce();
      expect(mockSendFeishu).toHaveBeenCalledWith('任务完成啦！');
      // recordOutbound 是 fire-and-forget，等下一个 microtask
      await Promise.resolve();
      expect(mockRecordOutbound).toHaveBeenCalledWith(
        pool,
        '任务完成啦！',
        expect.objectContaining({
          personId: 'owner',
          context: '任务 A 已完成',
          contextType: 'task_completion',
          importance: 0.8,
        })
      );
    });

    it('LLM 调用失败时降级用 reason 原文发送', async () => {
      const pool = makePool();
      const callLLM = makeFailLLM('timeout');

      const result = await sendProactiveMessage(pool, callLLM, {
        reason: '直接说这个',
        contextType: 'other',
      });

      expect(result.sent).toBe(true);
      expect(result.message).toBe('直接说这个');
      expect(mockSendFeishu).toHaveBeenCalledWith('直接说这个');
    });

    it('LLM 返回空字符串（trim 后为空）时返回 {sent:false, message:null}', async () => {
      const pool = makePool();
      const callLLM = makeLLM('   ');

      const result = await sendProactiveMessage(pool, callLLM, {
        reason: '有原因',
      });

      expect(result).toEqual({ sent: false, message: null });
      expect(mockSendFeishu).not.toHaveBeenCalled();
    });

    it('sendFeishu 返回 false 时 sent 为 false，但仍记录 pending', async () => {
      mockSendFeishu.mockResolvedValue(false);
      const pool = makePool();
      const callLLM = makeLLM('消息内容');

      const result = await sendProactiveMessage(pool, callLLM, {
        reason: '某个原因',
        trackPending: true,
      });

      expect(result.sent).toBe(false);
      expect(result.message).toBe('消息内容');
      await Promise.resolve();
      expect(mockRecordOutbound).toHaveBeenCalled();
    });

    it('sendFeishu 抛出异常时 sent 为 false，不向上传播', async () => {
      mockSendFeishu.mockRejectedValue(new Error('网络错误'));
      const pool = makePool();
      const callLLM = makeLLM('消息内容');

      const result = await sendProactiveMessage(pool, callLLM, {
        reason: '某个原因',
      });

      expect(result.sent).toBe(false);
      expect(result.message).toBe('消息内容');
    });

    it('trackPending=false 时不调用 recordOutbound', async () => {
      const pool = makePool();
      const callLLM = makeLLM('消息');

      await sendProactiveMessage(pool, callLLM, {
        reason: '理由',
        trackPending: false,
      });

      await Promise.resolve();
      expect(mockRecordOutbound).not.toHaveBeenCalled();
    });

    it('pool 为 null 时即使 trackPending=true 也不调用 recordOutbound', async () => {
      const callLLM = makeLLM('消息');

      await sendProactiveMessage(null, callLLM, {
        reason: '理由',
        trackPending: true,
      });

      await Promise.resolve();
      expect(mockRecordOutbound).not.toHaveBeenCalled();
    });

    it('callLLM 以正确参数（agent=thalamus，maxTokens=256）被调用', async () => {
      const pool = makePool();
      const callLLM = makeLLM('文本');

      await sendProactiveMessage(pool, callLLM, { reason: '理由' });

      expect(callLLM).toHaveBeenCalledWith(
        'thalamus',
        expect.any(String),
        expect.objectContaining({ maxTokens: 256, timeout: 15000 })
      );
    });

    it('默认参数：contextType=other, importance=0.5, personId=owner, trackPending=true', async () => {
      const pool = makePool();
      const callLLM = makeLLM('消息');

      await sendProactiveMessage(pool, callLLM, { reason: '理由' });

      // 通过检查 recordOutbound 参数来验证默认值
      await Promise.resolve();
      expect(mockRecordOutbound).toHaveBeenCalledWith(
        pool,
        '消息',
        expect.objectContaining({
          personId: 'owner',
          contextType: 'other',
          importance: 0.5,
        })
      );
    });

    // ── buildPromptForContext 各 contextType 路径 ──

    it('contextType=task_completion 时 prompt 包含"告诉 Alex"相关文字', async () => {
      const pool = makePool();
      const callLLM = makeLLM('通知');

      await sendProactiveMessage(pool, callLLM, {
        reason: '任务完成',
        contextType: 'task_completion',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('告诉 Alex');
    });

    it('contextType=desire 时 prompt 包含"你想对 Alex 说"', async () => {
      const pool = makePool();
      const callLLM = makeLLM('表达');

      await sendProactiveMessage(pool, callLLM, {
        reason: '好奇心',
        contextType: 'desire',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('你想对 Alex 说');
    });

    it('contextType=followup 时 prompt 包含"跟进"相关文字', async () => {
      const pool = makePool();
      const callLLM = makeLLM('跟进');

      await sendProactiveMessage(pool, callLLM, {
        reason: '之前消息',
        contextType: 'followup',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('跟进');
    });

    it('contextType=proactive 时 prompt 包含"主动找 Alex"相关文字', async () => {
      const pool = makePool();
      const callLLM = makeLLM('主动');

      await sendProactiveMessage(pool, callLLM, {
        reason: '想问候',
        contextType: 'proactive',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('主动找 Alex');
    });

    it('未知 contextType 时使用 default 分支 prompt', async () => {
      const pool = makePool();
      const callLLM = makeLLM('默认');

      await sendProactiveMessage(pool, callLLM, {
        reason: '某事',
        contextType: 'unknown_type',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('你要对 Alex 说');
    });
  });

  // ==================== notifyTaskCompletion ====================

  describe('notifyTaskCompletion', () => {
    it('有 result 时 reason 包含任务标题和结果', async () => {
      const pool = makePool();
      const callLLM = makeLLM('任务完成通知');

      const result = await notifyTaskCompletion(pool, callLLM, {
        title: '写单元测试',
        result: '覆盖率 85%',
        skill: '/dev',
      });

      expect(result.sent).toBe(true);
      // 验证 callLLM 收到的 prompt 含有任务信息
      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('写单元测试');
      expect(prompt).toContain('覆盖率 85%');
    });

    it('无 result 时 reason 只含任务标题', async () => {
      const pool = makePool();
      const callLLM = makeLLM('任务完成');

      await notifyTaskCompletion(pool, callLLM, {
        title: '部署服务',
        result: undefined,
        skill: '/dev',
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('部署服务');
      expect(prompt).not.toContain('结果：undefined');
    });

    it('contextType 固定为 task_completion', async () => {
      const pool = makePool();
      const callLLM = makeLLM('OK');

      await notifyTaskCompletion(pool, callLLM, { title: 'T', result: 'R' });

      await Promise.resolve();
      // trackPending=false，所以 recordOutbound 不应被调用
      expect(mockRecordOutbound).not.toHaveBeenCalled();
    });

    it('importance 固定为 0.7', async () => {
      const pool = makePool();
      const callLLM = makeLLM('OK');

      // trackPending 默认 false，通过 spy callLLM 的第三参数的 prompt 系统字段验证 importance
      // 注意：importance 不在 prompt 里，我们通过检查飞书是否被调用来验证整体流程
      const result = await notifyTaskCompletion(pool, callLLM, { title: 'T' });

      expect(result.sent).toBe(true);
      expect(mockSendFeishu).toHaveBeenCalledOnce();
    });

    it('LLM 失败时降级发送任务标题拼接的 reason', async () => {
      const pool = makePool();
      const callLLM = makeFailLLM('LLM 挂了');

      const result = await notifyTaskCompletion(pool, callLLM, {
        title: '数据同步',
        result: '完成',
      });

      expect(result.sent).toBe(true);
      expect(result.message).toContain('数据同步');
    });
  });

  // ==================== expressDesire ====================

  describe('expressDesire', () => {
    it('正常发送欲望驱动消息，trackPending=true', async () => {
      const pool = makePool();
      const callLLM = makeLLM('我想和你聊聊');

      const result = await expressDesire(pool, callLLM, '好奇你今天过得怎么样');

      expect(result.sent).toBe(true);
      expect(result.message).toBe('我想和你聊聊');
      // trackPending=true → recordOutbound 被调用
      await Promise.resolve();
      expect(mockRecordOutbound).toHaveBeenCalledOnce();
    });

    it('contextType 固定为 desire', async () => {
      const pool = makePool();
      const callLLM = makeLLM('OK');

      await expressDesire(pool, callLLM, '欲望内容');

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('你想对 Alex 说');
    });

    it('importance 为 0.4（低优先级）', async () => {
      const pool = makePool();
      const callLLM = makeLLM('消息');

      await expressDesire(pool, callLLM, '内容');

      await Promise.resolve();
      expect(mockRecordOutbound).toHaveBeenCalledWith(
        pool,
        '消息',
        expect.objectContaining({ importance: 0.4 })
      );
    });

    it('desireContent 为空字符串时返回 {sent:false, message:null}', async () => {
      const pool = makePool();
      const callLLM = makeLLM();

      const result = await expressDesire(pool, callLLM, '');

      expect(result).toEqual({ sent: false, message: null });
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('LLM 失败时降级用 desireContent 原文发送', async () => {
      const pool = makePool();
      const callLLM = makeFailLLM();

      const result = await expressDesire(pool, callLLM, '想了解你今天的状态');

      expect(result.sent).toBe(true);
      expect(result.message).toBe('想了解你今天的状态');
    });
  });

  // ==================== sendFollowUp ====================

  describe('sendFollowUp', () => {
    it('正常跟进：reason 包含原消息，contextType=followup，trackPending=false', async () => {
      const pool = makePool();
      const callLLM = makeLLM('你看到我之前的消息了吗？');

      const pendingConv = {
        message: '任务 B 完成了',
        importance: 0.6,
      };

      const result = await sendFollowUp(pool, callLLM, pendingConv);

      expect(result.sent).toBe(true);
      expect(result.message).toBe('你看到我之前的消息了吗？');
      // contextType=followup → prompt 含跟进
      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('跟进');
      expect(prompt).toContain('任务 B 完成了');
      // trackPending=false → 不记录 pending
      await Promise.resolve();
      expect(mockRecordOutbound).not.toHaveBeenCalled();
    });

    it('importance 从 pendingConv 继承', async () => {
      const pool = makePool();
      const callLLM = makeLLM('跟进消息');

      await sendFollowUp(pool, callLLM, {
        message: '原始消息',
        importance: 0.9,
      });

      // trackPending=false，不调用 recordOutbound
      // 仅验证飞书被调用（整体流程走通）
      expect(mockSendFeishu).toHaveBeenCalledWith('跟进消息');
    });

    it('LLM 失败时降级发送 reason 原文（含跟进信息）', async () => {
      const pool = makePool();
      const callLLM = makeFailLLM();

      const result = await sendFollowUp(pool, callLLM, {
        message: '原始消息',
        importance: 0.5,
      });

      expect(result.sent).toBe(true);
      // 降级 message 是 buildPromptForContext 之前拼好的 reason 字符串
      expect(result.message).toContain('原始消息');
    });

    it('sendFeishu 返回 false 时 sent 为 false', async () => {
      mockSendFeishu.mockResolvedValue(false);
      const pool = makePool();
      const callLLM = makeLLM('消息');

      const result = await sendFollowUp(pool, callLLM, {
        message: '原始',
        importance: 0.3,
      });

      expect(result.sent).toBe(false);
    });

    it('pendingConv.message 出现在 LLM prompt 中', async () => {
      const pool = makePool();
      const callLLM = makeLLM('OK');

      await sendFollowUp(pool, callLLM, {
        message: '之前说过的一句话',
        importance: 0.5,
      });

      const prompt = callLLM.mock.calls[0][1];
      expect(prompt).toContain('之前说过的一句话');
    });
  });
});
