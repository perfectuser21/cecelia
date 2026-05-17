import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyPublishFailure,
  calcPublishBackoffSec,
  PUBLISH_FAILURE_TYPE,
  monitorPublishQueue,
  checkWechatAuthFail,
} from '../publish-monitor.js';

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

import { raise } from '../alerting.js';

// ─── classifyPublishFailure ────────────────────────────────────────────────────

describe('classifyPublishFailure', () => {
  it('null/空 → unknown', () => {
    expect(classifyPublishFailure(null)).toBe('unknown');
    expect(classifyPublishFailure('')).toBe('unknown');
    expect(classifyPublishFailure(undefined)).toBe('unknown');
  });

  it('auth_fail 模式匹配', () => {
    expect(classifyPublishFailure('unauthorized access')).toBe('auth_fail');
    expect(classifyPublishFailure('Authentication failed: invalid token')).toBe('auth_fail');
    expect(classifyPublishFailure('token expired, please re-login')).toBe('auth_fail');
    expect(classifyPublishFailure('账号失效，请重新登录')).toBe('auth_fail');
    expect(classifyPublishFailure('凭据失效')).toBe('auth_fail');
  });

  it('rate_limit 模式匹配', () => {
    expect(classifyPublishFailure('Rate limit exceeded')).toBe('rate_limit');
    expect(classifyPublishFailure('too many requests, 429')).toBe('rate_limit');
    expect(classifyPublishFailure('Quota exceeded for today')).toBe('rate_limit');
    expect(classifyPublishFailure('限流，请稍后重试')).toBe('rate_limit');
  });

  it('content_reject 模式匹配', () => {
    expect(classifyPublishFailure('内容违规，审核不通过')).toBe('content_reject');
    expect(classifyPublishFailure('content rejected: violates community guidelines')).toBe('content_reject');
    expect(classifyPublishFailure('policy violation detected')).toBe('content_reject');
  });

  it('network 模式匹配', () => {
    expect(classifyPublishFailure('ECONNREFUSED 127.0.0.1:3000')).toBe('network');
    expect(classifyPublishFailure('connection timeout after 30s')).toBe('network');
    expect(classifyPublishFailure('network error: socket hang up')).toBe('network');
    expect(classifyPublishFailure('service unavailable')).toBe('network');
  });

  it('auth_fail 优先级高于 rate_limit', () => {
    expect(classifyPublishFailure('unauthorized and rate limited')).toBe('auth_fail');
  });

  it('content_reject 优先级高于 network', () => {
    expect(classifyPublishFailure('内容违规 ECONNREFUSED')).toBe('content_reject');
  });

  it('无匹配 → unknown', () => {
    expect(classifyPublishFailure('some random error message')).toBe('unknown');
  });
});

// ─── calcPublishBackoffSec ────────────────────────────────────────────────────

describe('calcPublishBackoffSec', () => {
  it('network/unknown 使用标准退避 30s * 2^N', () => {
    expect(calcPublishBackoffSec(0, 'network')).toBe(30);   // 30 * 1 * 1
    expect(calcPublishBackoffSec(1, 'network')).toBe(60);   // 30 * 1 * 2
    expect(calcPublishBackoffSec(2, 'unknown')).toBe(120);  // 30 * 1 * 4
  });

  it('rate_limit 退避翻倍', () => {
    expect(calcPublishBackoffSec(0, 'rate_limit')).toBe(60);   // 30 * 2 * 1
    expect(calcPublishBackoffSec(1, 'rate_limit')).toBe(120);  // 30 * 2 * 2
    expect(calcPublishBackoffSec(2, 'rate_limit')).toBe(240);  // 30 * 2 * 4
  });

  it('退避上限 1800s', () => {
    expect(calcPublishBackoffSec(10, 'network')).toBe(1800);
    expect(calcPublishBackoffSec(10, 'rate_limit')).toBe(1800);
  });
});

// ─── monitorPublishQueue 集成行为 ─────────────────────────────────────────────

describe('monitorPublishQueue - failure_type 路由', () => {
  let mockPool;
  let queryMock;

  beforeEach(() => {
    queryMock = vi.fn();
    mockPool = { query: queryMock };

    // 默认：fetchRetryableTasks → 空列表；后续查询返回空
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  function setupRetryableTasks(tasks) {
    // 第一次 query = fetchRetryableTasks
    queryMock.mockResolvedValueOnce({ rows: tasks, rowCount: tasks.length });
  }

  it('auth_fail 任务：persistFailureType 被调用，不重试', async () => {
    setupRetryableTasks([
      { id: 'task-1', title: '抖音发布', retry_count: 0, payload: { platform: 'douyin' }, error_message: 'unauthorized access' },
    ]);
    // isAlreadyPublished query → no rows
    queryMock.mockResolvedValueOnce({ rows: [] });

    await monitorPublishQueue(mockPool);

    // 找 persistFailureType 的 UPDATE 调用（只改 payload，不改 status）
    const updateCalls = queryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('SET payload') && !sql.includes("status = 'queued'") && !sql.includes("status = 'completed'")
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    // persistFailureType: pool.query(sql, [taskId, jsonString]) → call[1] = [taskId, jsonString]
    const payload = JSON.parse(updateCalls[0][1][1]);
    expect(payload.failure_type).toBe('auth_fail');

    // retryTask 的 SET status = 'queued' 不应该被调用
    const retryCalls = queryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("status = 'queued'")
    );
    expect(retryCalls).toHaveLength(0);
  });

  it('content_reject 任务：不重试，写入 failure_type', async () => {
    setupRetryableTasks([
      { id: 'task-2', title: '微博发布', retry_count: 1, payload: { platform: 'weibo' }, error_message: '内容违规，审核不通过' },
    ]);

    await monitorPublishQueue(mockPool);

    const retryCalls = queryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("status = 'queued'")
    );
    expect(retryCalls).toHaveLength(0);
  });

  it('rate_limit 任务：以 2x 退避重试，payload 含 failure_type=rate_limit', async () => {
    setupRetryableTasks([
      { id: 'task-3', title: '快手发布', retry_count: 0, payload: { platform: 'kuaishou', pipeline_id: 'p1' }, error_message: 'too many requests, 429' },
    ]);
    // isAlreadyPublished → 未发布
    queryMock.mockResolvedValueOnce({ rows: [] });
    // retryTask UPDATE → success
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await monitorPublishQueue(mockPool);

    const retryCalls = queryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("status = 'queued'")
    );
    expect(retryCalls.length).toBeGreaterThanOrEqual(1);

    // retryTask: pool.query(sql, [taskId, retryCount, jsonString]) → call[1] = [taskId, retryCount, jsonString]
    const payloadArg = JSON.parse(retryCalls[0][1][2]);
    expect(payloadArg.failure_type).toBe('rate_limit');
    // rate_limit 首次退避应为 60s（30 * 2 * 2^0）
    const nextRunAt = new Date(payloadArg.next_run_at).getTime();
    const expectedDelay = 60 * 1000;
    expect(nextRunAt - Date.now()).toBeGreaterThan(expectedDelay - 2000);
    expect(nextRunAt - Date.now()).toBeLessThan(expectedDelay + 2000);
  });

  it('network 任务：以标准退避重试，payload 含 failure_type=network', async () => {
    setupRetryableTasks([
      { id: 'task-4', title: '头条发布', retry_count: 0, payload: { platform: 'toutiao', pipeline_id: 'p2' }, error_message: 'ECONNREFUSED 127.0.0.1' },
    ]);
    queryMock.mockResolvedValueOnce({ rows: [] }); // isAlreadyPublished
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // retryTask

    await monitorPublishQueue(mockPool);

    const retryCalls = queryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("status = 'queued'")
    );
    const payloadArg = JSON.parse(retryCalls[0][1][2]);
    expect(payloadArg.failure_type).toBe('network');
    // 标准退避 30s
    const nextRunAt = new Date(payloadArg.next_run_at).getTime();
    expect(nextRunAt - Date.now()).toBeGreaterThan(28 * 1000);
    expect(nextRunAt - Date.now()).toBeLessThan(32 * 1000);
  });
});

// ─── 微信 error_code 识别 ──────────────────────────────────────────────────────

describe('classifyPublishFailure - 微信 error_code', () => {
  it('payload.error_code=40001 → auth_fail', () => {
    expect(classifyPublishFailure(null, { error_code: 40001 })).toBe('auth_fail');
    expect(classifyPublishFailure('', { error_code: 40001 })).toBe('auth_fail');
    expect(classifyPublishFailure('some error', { error_code: 40001 })).toBe('auth_fail');
  });

  it('payload.error_code=40014/42001/42007 → auth_fail', () => {
    expect(classifyPublishFailure(null, { error_code: 40014 })).toBe('auth_fail');
    expect(classifyPublishFailure(null, { error_code: 42001 })).toBe('auth_fail');
    expect(classifyPublishFailure(null, { error_code: 42007 })).toBe('auth_fail');
  });

  it('payload.error_code 字符串形式也能识别', () => {
    expect(classifyPublishFailure(null, { error_code: '40001' })).toBe('auth_fail');
  });

  it('payload.error_code 非微信特征码 → 走普通 error_message 分类', () => {
    expect(classifyPublishFailure('some random error', { error_code: 99999 })).toBe('unknown');
    expect(classifyPublishFailure('rate limit exceeded', { error_code: 99999 })).toBe('rate_limit');
  });

  it('无 payload 时不影响原有分类逻辑', () => {
    expect(classifyPublishFailure('unauthorized')).toBe('auth_fail');
    expect(classifyPublishFailure('too many requests')).toBe('rate_limit');
    expect(classifyPublishFailure('ECONNREFUSED')).toBe('network');
  });
});

// ─── checkWechatAuthFail ────────────────────────────────────────────────────

describe('checkWechatAuthFail', () => {
  let mockPool;
  let queryMock;

  beforeEach(() => {
    queryMock = vi.fn();
    mockPool = { query: queryMock };
    vi.clearAllMocks();
  });

  it('≥2 条连续 auth_fail → raise P0 告警，返回连续次数', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 't1', title: '公众号A', payload: { platform: 'wechat', failure_type: 'auth_fail', account_name: '公众号A' } },
        { id: 't2', title: '公众号A', payload: { platform: 'wechat', failure_type: 'auth_fail', account_name: '公众号A' } },
        { id: 't3', title: '公众号A', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
      ],
    });

    const count = await checkWechatAuthFail(mockPool);

    expect(count).toBe(3);
    expect(raise).toHaveBeenCalledWith(
      'P0',
      'wechat_auth_fail',
      expect.stringContaining('公众号A')
    );
    expect(raise).toHaveBeenCalledWith(
      'P0',
      'wechat_auth_fail',
      expect.stringContaining('3')
    );
  });

  it('payload.error_code=40001 识别为 auth_fail → 满足阈值触发告警', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 't1', title: '测试公众号', payload: { platform: 'wechat', error_code: 40001 } },
        { id: 't2', title: '测试公众号', payload: { platform: 'wechat', error_code: 40001 } },
      ],
    });

    const count = await checkWechatAuthFail(mockPool);

    expect(count).toBe(2);
    expect(raise).toHaveBeenCalledWith('P0', 'wechat_auth_fail', expect.stringContaining('access_token'));
  });

  it('只有 1 次 auth_fail → 不触发告警', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 't1', title: '公众号B', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
      ],
    });

    const count = await checkWechatAuthFail(mockPool);

    expect(count).toBe(1);
    expect(raise).not.toHaveBeenCalled();
  });

  it('连续中断（中间有 network failure）→ 不触发告警', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 't1', title: '公众号C', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
        { id: 't2', title: '公众号C', payload: { platform: 'wechat', failure_type: 'network' } },
        { id: 't3', title: '公众号C', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
      ],
    });

    const count = await checkWechatAuthFail(mockPool);

    expect(count).toBe(1);
    expect(raise).not.toHaveBeenCalled();
  });

  it('无失败记录 → 返回 0，不告警', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const count = await checkWechatAuthFail(mockPool);

    expect(count).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('告警消息含账号名（优先 payload.account_name，降级 title）', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 't1', title: 'title-fallback', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
        { id: 't2', title: 'title-fallback', payload: { platform: 'wechat', failure_type: 'auth_fail' } },
      ],
    });

    await checkWechatAuthFail(mockPool);

    expect(raise).toHaveBeenCalledWith(
      'P0',
      'wechat_auth_fail',
      expect.stringContaining('title-fallback')
    );
  });
});
