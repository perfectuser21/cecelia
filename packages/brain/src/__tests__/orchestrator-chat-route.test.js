/** 只验证 server.js 实际登记的聊天 handler 合同，不启动整个服务器。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import express from 'express';
import request from 'supertest';

const mockHandleChat = vi.fn();
const path = '/api/brain/orchestrator/chat';

function createTestApp() {
  // server 顶层会启动迁移/定时器；仅执行从真实 AST 选出的原始登记语句，绝不复制 handler。
  const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const registrations = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && !node.callee.computed && node.callee.object.name === 'app'
      && node.callee.property.name === 'post' && node.arguments[0]?.value === path) {
      registrations.push(node);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  expect(registrations).toHaveLength(1);
  const registration = registrations[0];
  expect(registration.arguments).toHaveLength(2);
  expect(registration.arguments[1].type).toBe('ArrowFunctionExpression');
  // 确认注入的是实际 handler 的生产依赖名，而不是任意同名测试函数。
  const binding = ast.body.find(node => node.type === 'ImportDeclaration'
    && node.source.value === './src/orchestrator-chat.js');
  expect(binding?.specifiers.some(s => s.imported?.name === 'handleChat'
    && s.local.name === 'handleChat')).toBe(true);
  const app = express();
  app.use(express.json());
  vm.runInNewContext(source.slice(registration.start, registration.end), {
    app, handleChat: mockHandleChat, console: { error: vi.fn() },
  }, { timeout: 1000, filename: 'server.js:orchestrator-chat-registration' });
  return app;
}

describe('POST /api/brain/orchestrator/chat — 生产登记 handler', () => {
  let app;
  beforeEach(() => { mockHandleChat.mockReset(); app = createTestApp(); });

  it('正常消息返回 handler 结果并传入实际消息', async () => {
    mockHandleChat.mockResolvedValue({ reply: '当前有3个待处理任务。', routing_level: 0, intent: 'QUERY_STATUS' });
    const res = await request(app).post(path).send({ message: '查询任务', messages: [] }).expect(200);
    expect(res.body).toEqual({ reply: '当前有3个待处理任务。', routing_level: 0, intent: 'QUERY_STATUS' });
    expect(mockHandleChat).toHaveBeenCalledTimes(1);
    expect(mockHandleChat).toHaveBeenCalledWith('查询任务', {}, []);
  });
  it('缺少 message 拒绝请求且不调用聊天服务', async () => {
    const res = await request(app).post(path).send({ messages: [] }).expect(400);
    expect(res.body).toEqual({ error: 'message is required' });
    expect(mockHandleChat).not.toHaveBeenCalled();
  });
  it('聊天服务失败响应500及错误信息', async () => {
    mockHandleChat.mockRejectedValue(new Error('测试服务错误503'));
    const res = await request(app).post(path).send({ message: '测试消息' }).expect(500);
    expect(res.body).toEqual({ error: '测试服务错误503' });
  });
  it('历史消息与上下文透传到聊天服务', async () => {
    mockHandleChat.mockResolvedValue({ reply: '好的', routing_level: 0, intent: 'GENERAL' });
    const history = [{ role: 'user', content: '上一条消息' }];
    const context = { conversation_id: 'conv-123' };
    const res = await request(app).post(path).send({ message: '继续', messages: history, context }).expect(200);
    expect(res.body.reply).toBe('好的');
    expect(mockHandleChat).toHaveBeenCalledTimes(1);
    expect(mockHandleChat).toHaveBeenCalledWith('继续', context, history);
  });
  it('历史消息与上下文省略时使用空默认值', async () => {
    mockHandleChat.mockResolvedValue({ reply: '好', routing_level: 0, intent: 'GENERAL' });
    const res = await request(app).post(path).send({ message: '你好' }).expect(200);
    expect(res.body.reply).toBe('好');
    expect(mockHandleChat).toHaveBeenCalledTimes(1);
    expect(mockHandleChat).toHaveBeenCalledWith('你好', {}, []);
  });
});
