/**
 * Tests for POST /api/brain/orchestrator/chat route
 * 测试路由处理层（400/500/200），不测 handleChat 内部逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock handleChat
const mockHandleChat = vi.hoisted(() => vi.fn());

vi.mock('../orchestrator-chat.js', () => ({
  handleChat: mockHandleChat,
}));

// 镜像 server.js 中注册的路由逻辑（独立 express app，不触发迁移/selfcheck）
function createTestApp() {
  const { handleChat } = require('../orchestrator-chat.js'); // eslint-disable-line
  const app = express();
  app.use(express.json());
  app.post('/api/brain/orchestrator/chat', async (req, res) => {
    try {
      const { message, messages = [], context = {} } = req.body;
      if (!message) return res.status(400).json({ error: 'message is required' });
      const result = await handleChat(message, context, messages);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  return app;
}

describe('POST /api/brain/orchestrator/chat', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 用 dynamic import 获取 mock 后的 handleChat
    const mod = await import('../orchestrator-chat.js');
    app = express();
    app.use(express.json());

    const { handleChat } = mod;

    app.post('/api/brain/orchestrator/chat', async (req, res) => {
      try {
        const { message, messages = [], context = {} } = req.body;
        if (!message) return res.status(400).json({ error: 'message is required' });
        const result = await handleChat(message, context, messages);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  });

  it('正常消息 → 返回 { reply, routing_level, intent }', async () => {
    mockHandleChat.mockResolvedValue({
      reply: '当前有 3 个待处理任务。',
      routing_level: 0,
      intent: 'QUERY_STATUS',
    });

    const res = await request(app)
      .post('/api/brain/orchestrator/chat')
      .send({ message: '你好，现在有什么待处理的任务？', messages: [] })
      .expect(200);

    expect(res.body.reply).toBe('当前有 3 个待处理任务。');
    expect(res.body.routing_level).toBe(0);
    expect(res.body.intent).toBe('QUERY_STATUS');
    expect(mockHandleChat).toHaveBeenCalledWith(
      '你好，现在有什么待处理的任务？',
      {},
      []
    );
  });

  it('缺少 message → 400', async () => {
    const res = await request(app)
      .post('/api/brain/orchestrator/chat')
      .send({ messages: [] })
      .expect(400);

    expect(res.body.error).toBe('message is required');
    expect(mockHandleChat).not.toHaveBeenCalled();
  });

  it('handleChat 抛错 → 500', async () => {
    mockHandleChat.mockRejectedValue(new Error('MiniMax API error: 503'));

    const res = await request(app)
      .post('/api/brain/orchestrator/chat')
      .send({ message: '测试消息' })
      .expect(500);

    expect(res.body.error).toBe('MiniMax API error: 503');
  });

  it('传入 messages 和 context → 透传给 handleChat', async () => {
    mockHandleChat.mockResolvedValue({
      reply: '好的',
      routing_level: 0,
      intent: 'GENERAL',
    });

    const history = [{ role: 'user', content: '上一条消息' }];
    const ctx = { conversation_id: 'conv-123' };

    await request(app)
      .post('/api/brain/orchestrator/chat')
      .send({ message: '继续', messages: history, context: ctx })
      .expect(200);

    expect(mockHandleChat).toHaveBeenCalledWith('继续', ctx, history);
  });

  it('messages 缺省时默认为 []', async () => {
    mockHandleChat.mockResolvedValue({
      reply: '好',
      routing_level: 0,
      intent: 'GENERAL',
    });

    await request(app)
      .post('/api/brain/orchestrator/chat')
      .send({ message: '你好' })
      .expect(200);

    expect(mockHandleChat).toHaveBeenCalledWith('你好', {}, []);
  });
});
