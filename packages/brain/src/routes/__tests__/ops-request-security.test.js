import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'node:http';
const nativeFetch = globalThis.fetch;
vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../../tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));

vi.mock('../../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('../shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
vi.mock('../../circuit-breaker.js', () => ({ getAllStates: vi.fn(() => ({})) }));
vi.mock('../../receipt-collector.js', () => ({ recordActionReceipt: vi.fn(), resolveActionReceipt: vi.fn() }));
let server, client, pool, handleChat, fetchSpy;
const calls = [];
function event({ chatId = 'oc_group', openId = 'ou_sender', messageId = 'om_message', type = 'text', key = 'resource_key' } = {}) {
  return { header: { event_type: 'im.message.receive_v1' }, event: {
    sender: { sender_id: { open_id: openId } }, message: {
      chat_type: 'group', chat_id: chatId, message_id: messageId, message_type: type,
      mentions: [{ name: 'Cecelia' }],
      content: JSON.stringify(type === 'text' ? { text: '@Cecelia test' } : type === 'image' ? { image_key: key } : { file_key: key }),
    },
  } };
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); calls.length = 0;
  vi.stubEnv('FEISHU_APP_ID', 'fixture-app'); vi.stubEnv('FEISHU_APP_SECRET', 'fixture-secret');
  vi.stubEnv('FEISHU_OWNER_OPEN_IDS', ''); vi.stubEnv('FEISHU_BOT_OPEN_ID', '');
  pool = (await import('../../db.js')).default; pool.query.mockResolvedValue({ rows: [] });
  handleChat = (await import('../../orchestrator-chat.js')).handleChat; handleChat.mockResolvedValue({ reply: '' });
  fetchSpy = vi.fn(async (url, options = {}) => {
    const u = String(url); calls.push({ url: u, options });
    if (u.includes('tenant_access_token')) return { json: async () => ({ code: 0, tenant_access_token: 'fixture-token' }) };
    if (u.includes('/members')) return { json: async () => ({ code: 0, data: { items: [{ member_id: 'ou_member', name: '成员' }] } }) };
    if (u.includes('/contact/v3/users/')) return { json: async () => ({ code: 0, data: { user: { name: '访客' } } }) };
    if (u.includes('/resources/')) return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (u.includes('file_recognize')) return { json: async () => ({ code: 0, data: { recognition_text: 'hello' } }) };
    return { json: async () => ({ code: 0, data: { message_id: 'om_reply' } }) };
  });
  vi.stubGlobal('fetch', fetchSpy);
  for (const level of ['log', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {});
  const { default: ops } = await import('../ops.js');
  const app = express(); app.use(express.json()); app.use('/api/brain', ops);
  app.get('/api/brain/unrelated', (_req, res) => res.json({ ok: true }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  client = request(`http://127.0.0.1:${server.address().port}`);
});
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
async function sendEvent(payload) {
  expect((await client.post('/api/brain/feishu/event').send(payload)).status).toBe(200);
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalledTimes(1));
}
describe('飞书真实事件处理的请求边界', () => {
  it.each([
    { chatId: '../../auth/other' }, { openId: '../other?admin=1' },
    { type: 'image', messageId: '../messages', key: 'img_key' },
    { type: 'image', key: '../secret#fragment' },
    { chatId: '..' }, { openId: '%2e%2e' }, { type: 'image', key: 'resource\\escape' },
    { chatId: 'oc_\u0000' }, { openId: 'ou_\u001f' }, { type: 'image', key: 'img_\u007f' },
  ])('恶意路径段不发出越过既定endpoint的请求 %j', async input => {
    await sendEvent(event(input));
    const allowed = /^https:\/\/open\.feishu\.cn\/open-apis\/(?:auth\/v3\/tenant_access_token\/internal|im\/v1\/chats\/[A-Za-z0-9_-]+\/members\?member_id_type=open_id&page_size=100|contact\/v3\/users\/[A-Za-z0-9_-]+\?user_id_type=open_id|im\/v1\/messages\/[A-Za-z0-9_-]+\/resources\/[A-Za-z0-9_-]+\?type=image)$/;
    expect(calls.every(c => allowed.test(c.url))).toBe(true);
  });
  it.each(['image', 'audio'])('正常%s事件保留成员/用户/资源API并拒绝HTTP重定向', async type => {
    await sendEvent(event({ type }));
    expect(calls.some(c => c.url.includes('/resources/resource_key?type='))).toBe(true);
    expect(calls.some(c => c.url.includes('/chats/oc_group/members?'))).toBe(true);
    expect(calls.some(c => c.url.includes('/users/ou_sender?'))).toBe(true);
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe('https://open.feishu.cn');
      expect(c.options.redirect).toBe('error');
    }
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO feishu_users'), expect.arrayContaining(['ou_member']));
  });
  it.each([{ messageId: '..' }, { key: '../audio' }, { key: '%2fescape' }])('音频恶意ID不能下载或转写 %j', async input => {
    expect((await client.post('/api/brain/feishu/event').send(event({ type: 'audio', ...input }))).status).toBe(200);
    await vi.waitFor(() => expect(calls.some(c => c.url.includes('/messages?receive_id_type=chat_id'))).toBe(true));
    expect(calls.some(c => c.url.includes('/resources/') || c.url.includes('file_recognize'))).toBe(false);
    expect(handleChat).not.toHaveBeenCalled();
  });
  it('真实fetch遇302不能访问第二个目标，图片事件仍正常回执并降级', async () => {
    let escapedRequests = 0;
    const target = createServer((_req, res) => { escapedRequests++; res.end('fixture image'); });
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    const redirect = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/escape` }); res.end();
    });
    await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
    const fallback = fetchSpy.getMockImplementation();
    fetchSpy.mockImplementation((url, options) => String(url).includes('/resources/')
      ? nativeFetch(`http://127.0.0.1:${redirect.address().port}/redirect`, options)
      : fallback(url, options));
    try {
      await sendEvent(event({ type: 'image' }));
      expect(escapedRequests).toBe(0);
      expect(handleChat.mock.calls[0][3]).toBeNull();
    } finally {
      await Promise.all([target, redirect].map(s => new Promise(resolve => s.close(resolve))));
    }
  });
  it('用户名失败日志使用固定首参，含格式符的ID只能作为数据', async () => {
    fetchSpy.mockImplementation(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('tenant_access_token')) return { json: async () => ({ code: 0, tenant_access_token: 'fixture-token' }) };
      throw Error('fixture failure %j');
    });
    await sendEvent(event({ openId: 'ou_%s' }));
    const warning = console.warn.mock.calls.find(args => String(args[0]).includes('获取用户名失败'));
    expect(warning[0]).toBe('[feishu/event] 获取用户名失败:');
    expect(warning[1]).toBe('ou_%s');
  });
});
const protectedRoutes = [
  ['get', '/desires'], ['get', '/desires/stats'], ['patch', '/desires/id'], ['post', '/desires/id/respond'],
  ['get', '/decomposition/missing'], ['get', '/decomposition/stats'], ['get', '/learnings'],
  ['get', '/progress/latest'], ['get', '/suggestions'], ['get', '/goal-evaluations'],
  ['get', '/goal-evaluations/latest'], ['get', '/learnings/stats'], ['get', '/feishu/users'], ['get', '/feishu/groups'],
  ['get', '/dispatch/weights'], ['get', '/dispatch/effectiveness'], ['post', '/manual/ask'],
  ['get', '/reports'], ['get', '/reports/latest'], ['get', '/pr-progress/test'], ['post', '/webhook/github'],
  ['get', '/dev-pipeline/success-rate'], ['get', '/dev-pipeline/health'], ['post', '/deploy/rollback'],
];
describe('ops匹配路由的真实HTTP限流', () => {
  it('预算耗尽后24个告警路由返回429，DB与helper不执行', async () => {
    for (let i = 0; i < 1200; i++) expect((await client.get('/api/brain/feishu/users')).status).toBe(200);
    pool.query.mockClear();
    const dispatch = (await import('../../dispatch-stats.js')).getDispatchStats; dispatch.mockClear();
    for (const [method, path] of protectedRoutes) {
      const result = await client[method]('/api/brain' + path).send({});
      expect(result.status, method + ' ' + path).toBe(429);
    }
    expect(pool.query).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  }, 20000);
  it('未匹配流量不消费ops预算，挑战回执保留200', async () => {
    for (let i = 0; i < 1201; i++) expect((await client.get('/api/brain/unrelated')).status).toBe(200);
    const result = await client.get('/api/brain/feishu/users');
    expect(result.status).toBe(200); expect(result.headers.ratelimit).toContain('remaining=1199');
    expect((await client.post('/api/brain/feishu/event').send({ challenge: 'fixture-challenge' })).body).toEqual({ challenge: 'fixture-challenge' });
  }, 20000);
});
