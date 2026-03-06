import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 全局 fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// 保存原始环境变量
const originalEnv = { ...process.env };

describe('Notifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  // ─── 辅助函数：动态加载 notifier 模块（每次获取全新模块实例） ───
  async function loadNotifier(envOverrides = {}) {
    // 清理环境变量（确保不受上次测试影响）
    delete process.env.FEISHU_BOT_WEBHOOK;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_OWNER_OPEN_IDS;

    // 设置指定的环境变量
    for (const [key, value] of Object.entries(envOverrides)) {
      process.env[key] = value;
    }

    return import('../notifier.js');
  }

  // ─── RATE_LIMIT_MS 导出 ───
  describe('RATE_LIMIT_MS', () => {
    it('导出 60 秒的速率限制常量', async () => {
      const mod = await loadNotifier();
      expect(mod.RATE_LIMIT_MS).toBe(60 * 1000);
    });
  });

  // ─── sendFeishu：Webhook 渠道 ───
  describe('sendFeishu - Webhook 渠道', () => {
    it('Webhook 已配置时，通过 Webhook 发送成功返回 true', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://open.feishu.cn/webhook/test' });

      const result = await mod.sendFeishu('测试消息');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.feishu.cn/webhook/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_type: 'text', content: { text: '测试消息' } }),
        })
      );
    });

    it('Webhook 返回非 ok 状态码时返回 false', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://open.feishu.cn/webhook/test' });

      const result = await mod.sendFeishu('测试消息');

      expect(result).toBe(false);
    });

    it('Webhook 网络异常时返回 false（不抛出异常）', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://open.feishu.cn/webhook/test' });

      const result = await mod.sendFeishu('测试消息');

      expect(result).toBe(false);
    });
  });

  // ─── sendFeishu：Open API 降级渠道 ───
  describe('sendFeishu - Open API 降级', () => {
    it('Webhook 未配置时降级到 Open API，成功发送返回 true', async () => {
      // 第一次 fetch: 获取 tenant_access_token
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 0, tenant_access_token: 'test-token-123' }),
      });
      // 第二次 fetch: 发私信
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 0 }),
      });

      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id-test',
        FEISHU_APP_SECRET: 'app-secret-test',
        FEISHU_OWNER_OPEN_IDS: 'ou_alex123',
      });

      const result = await mod.sendFeishu('降级消息');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // 验证第一次调用（获取 token）
      const [authUrl, authOpts] = mockFetch.mock.calls[0];
      expect(authUrl).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
      expect(JSON.parse(authOpts.body)).toEqual({ app_id: 'app-id-test', app_secret: 'app-secret-test' });

      // 验证第二次调用（发私信）
      const [sendUrl, sendOpts] = mockFetch.mock.calls[1];
      expect(sendUrl).toContain('/im/v1/messages');
      expect(sendOpts.headers['Authorization']).toBe('Bearer test-token-123');
      const sendBody = JSON.parse(sendOpts.body);
      expect(sendBody.receive_id).toBe('ou_alex123');
      expect(sendBody.msg_type).toBe('text');
    });

    it('Open API 凭据未配置时返回 false', async () => {
      const mod = await loadNotifier({
        // 不配置任何飞书凭据
      });

      const result = await mod.sendFeishu('无凭据消息');

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('Open API 仅配置 APP_ID 但缺少 APP_SECRET 时返回 false', async () => {
      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id-test',
        FEISHU_OWNER_OPEN_IDS: 'ou_alex123',
      });

      const result = await mod.sendFeishu('缺少 secret');

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('Open API 缺少 FEISHU_OWNER_OPEN_IDS 时返回 false', async () => {
      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id-test',
        FEISHU_APP_SECRET: 'app-secret-test',
      });

      const result = await mod.sendFeishu('缺少 open_id');

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('Open API 获取 token 失败时返回 false', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 99999, msg: 'invalid app_id' }),
      });

      const mod = await loadNotifier({
        FEISHU_APP_ID: 'bad-id',
        FEISHU_APP_SECRET: 'bad-secret',
        FEISHU_OWNER_OPEN_IDS: 'ou_alex123',
      });

      const result = await mod.sendFeishu('token 失败');

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('Open API 发私信失败时返回 false', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 0, tenant_access_token: 'token-ok' }),
      });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 230001, msg: 'no permission' }),
      });

      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id-test',
        FEISHU_APP_SECRET: 'app-secret-test',
        FEISHU_OWNER_OPEN_IDS: 'ou_alex123',
      });

      const result = await mod.sendFeishu('无权限');

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('Open API 网络异常时返回 false（不抛出异常）', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id-test',
        FEISHU_APP_SECRET: 'app-secret-test',
        FEISHU_OWNER_OPEN_IDS: 'ou_alex123',
      });

      const result = await mod.sendFeishu('网络异常');

      expect(result).toBe(false);
    });

    it('FEISHU_OWNER_OPEN_IDS 有多个时取第一个', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 0, tenant_access_token: 'tok' }),
      });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 0 }),
      });

      const mod = await loadNotifier({
        FEISHU_APP_ID: 'app-id',
        FEISHU_APP_SECRET: 'app-secret',
        FEISHU_OWNER_OPEN_IDS: 'ou_first, ou_second, ou_third',
      });

      const result = await mod.sendFeishu('多 ID 测试');
      expect(result).toBe(true);

      // 验证用的是第一个 open_id
      const sendBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(sendBody.receive_id).toBe('ou_first');
    });
  });

  // ─── 速率限制测试 ───
  describe('速率限制（Rate Limiting）', () => {
    it('相同事件在 60 秒内第二次调用被跳过', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      const taskInfo = { task_id: 'rate-test-1', title: '测试任务' };
      const result1 = await mod.notifyTaskCompleted(taskInfo);
      const result2 = await mod.notifyTaskCompleted(taskInfo);

      expect(result1).toBe(true);
      expect(result2).toBe(false); // 被速率限制
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('不同事件不受速率限制影响', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      const result1 = await mod.notifyTaskCompleted({ task_id: 'task-a', title: '任务 A' });
      const result2 = await mod.notifyTaskCompleted({ task_id: 'task-b', title: '任务 B' });

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── notifyTaskCompleted ───
  describe('notifyTaskCompleted', () => {
    it('发送包含任务标题的完成通知', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskCompleted({ task_id: 'tc-1', title: '实现用户登录' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('任务完成');
      expect(body.content.text).toContain('实现用户登录');
    });

    it('有耗时信息时包含耗时', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskCompleted({ task_id: 'tc-2', title: '编译项目', duration_ms: 125000 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('125s');
    });

    it('无耗时信息时不包含耗时文字', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskCompleted({ task_id: 'tc-3', title: '快速任务' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).not.toContain('耗时');
    });
  });

  // ─── notifyTaskFailed ───
  describe('notifyTaskFailed', () => {
    it('发送包含任务标题的失败通知', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskFailed({ task_id: 'tf-1', title: '部署服务' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('任务失败');
      expect(body.content.text).toContain('部署服务');
    });

    it('有失败原因时包含原因', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskFailed({ task_id: 'tf-2', title: 'CI 检查', reason: 'lint 错误 3 处' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('原因');
      expect(body.content.text).toContain('lint 错误 3 处');
    });

    it('无失败原因时不包含原因字段', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyTaskFailed({ task_id: 'tf-3', title: '未知失败' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).not.toContain('原因');
    });
  });

  // ─── notifyCircuitOpen ───
  describe('notifyCircuitOpen', () => {
    it('发送熔断触发通知', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyCircuitOpen({ key: 'brain-executor', failures: 5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('熔断触发');
      expect(body.content.text).toContain('brain-executor');
      expect(body.content.text).toContain('5');
      expect(body.content.text).toContain('暂停派发');
    });
  });

  // ─── notifyPatrolCleanup ───
  describe('notifyPatrolCleanup', () => {
    it('发送巡逻清理通知', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyPatrolCleanup({ task_id: 'pc-1', title: '超时任务', elapsed_minutes: 120 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('巡逻清理');
      expect(body.content.text).toContain('超时任务');
      expect(body.content.text).toContain('120');
      expect(body.content.text).toContain('自动标记失败');
    });
  });

  // ─── notifyDailySummary ───
  describe('notifyDailySummary', () => {
    it('发送包含任务统计的日报', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyDailySummary({
        completed: 10,
        failed: 2,
        planned: 5,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const text = body.content.text;
      expect(text).toContain('日报');
      expect(text).toContain('10');
      expect(text).toContain('2');
      expect(text).toContain('5');
    });

    it('有熔断器打开时包含熔断信息', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyDailySummary({
        completed: 5,
        failed: 1,
        planned: 3,
        circuit_breakers: {
          'executor': { state: 'OPEN' },
          'dispatcher': { state: 'CLOSED' },
          'scheduler': { state: 'OPEN' },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const text = body.content.text;
      expect(text).toContain('熔断中');
      expect(text).toContain('executor');
      expect(text).toContain('scheduler');
      expect(text).not.toContain('dispatcher'); // CLOSED 不应出现在熔断列表中
    });

    it('所有熔断器关闭时不包含熔断信息', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyDailySummary({
        completed: 5,
        failed: 0,
        planned: 3,
        circuit_breakers: {
          'executor': { state: 'CLOSED' },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).not.toContain('熔断中');
    });

    it('circuit_breakers 为空对象时不包含熔断信息', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyDailySummary({
        completed: 0,
        failed: 0,
        planned: 0,
        circuit_breakers: {},
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).not.toContain('熔断中');
    });

    it('circuit_breakers 未提供时不崩溃', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      await mod.notifyDailySummary({
        completed: 1,
        failed: 0,
        planned: 0,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('日报');
      expect(body.content.text).not.toContain('熔断中');
    });

    it('日报不受速率限制（直接调用 sendFeishu）', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://webhook.test' });

      const summary = { completed: 1, failed: 0, planned: 0 };
      const result1 = await mod.notifyDailySummary(summary);
      const result2 = await mod.notifyDailySummary(summary);

      // 日报直接调用 sendFeishu，不经过 sendRateLimited，两次都应成功
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 导出完整性检查 ───
  describe('模块导出', () => {
    it('导出所有预期的函数和常量', async () => {
      const mod = await loadNotifier();
      expect(typeof mod.sendFeishu).toBe('function');
      expect(typeof mod.notifyTaskCompleted).toBe('function');
      expect(typeof mod.notifyTaskFailed).toBe('function');
      expect(typeof mod.notifyCircuitOpen).toBe('function');
      expect(typeof mod.notifyPatrolCleanup).toBe('function');
      expect(typeof mod.notifyDailySummary).toBe('function');
      expect(typeof mod.RATE_LIMIT_MS).toBe('number');
    });
  });
});
