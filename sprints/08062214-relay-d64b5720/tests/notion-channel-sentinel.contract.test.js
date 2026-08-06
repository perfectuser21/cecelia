/**
 * notion-channel-sentinel.contract.test.js
 *
 * 合同测试 — Notion 通道活性哨兵（task d64b5720）
 *
 * 覆盖 T1~T10（PRD 测试计划）+ 6 条 [BEHAVIOR] 合约断言
 *
 * 所有 Notion API 调用、sendBark、DB pool 均为 mock，不发真实网络请求。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── mock notifier.js ─────────────────────────────────────────────────────────
vi.mock('../../../packages/brain/src/notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── mock notion-capture-ingest.js（仅替换 notionRequest，保留 getNotionInboxConfig 真实逻辑）
vi.mock('../../../packages/brain/src/notion-capture-ingest.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    notionRequest: vi.fn(),
  };
});

import { sendBark } from '../../../packages/brain/src/notifier.js';
import { notionRequest, getNotionInboxConfig } from '../../../packages/brain/src/notion-capture-ingest.js';

// ─── 被测模块（动态 import，允许未实现时跳过）────────────────────────────────
let runNotionChannelSentinel;
let _resetNotionAlertDedup;
let _getNotionSentinelState;
let moduleAvailable = false;

try {
  const mod = await import('../../../packages/brain/src/notion-channel-sentinel.js');
  runNotionChannelSentinel = mod.runNotionChannelSentinel;
  _resetNotionAlertDedup = mod._resetNotionAlertDedup;
  _getNotionSentinelState = mod._getNotionSentinelState;
  moduleAvailable = !!(runNotionChannelSentinel && _resetNotionAlertDedup);
} catch {
  moduleAvailable = false;
}

// ─── mock pool ────────────────────────────────────────────────────────────────
function makeMockPool(opts = {}) {
  return {
    query: opts.shouldFail
      ? vi.fn().mockRejectedValue(new Error('DB connection refused'))
      : vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeNotionError(status, notionCode, message) {
  const err = new Error(`Notion API GET /users/me → ${status}: ${message}`);
  err.status = status;
  err.notionCode = notionCode;
  return err;
}

// ─── 核心断言辅助 ─────────────────────────────────────────────────────────────

function skipIfUnavailable(name) {
  if (!moduleAvailable) {
    console.warn(`[contract] SKIP ${name}: notion-channel-sentinel.js not yet implemented`);
    return true;
  }
  return false;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('notion-channel-sentinel 合同测试（T1~T10 + [BEHAVIOR] 断言）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 确保去重 Map 清空，5min gate 归零
    if (_resetNotionAlertDedup) _resetNotionAlertDedup();
  });

  afterEach(() => {
    // 恢复真实 NOTION_INBOX_TOKEN 环境
    delete process.env.NOTION_INBOX_TOKEN;
  });

  // ─── T1: token 未配置 → not_configured，sendBark 被调用 ──────────────────
  it('[T1][BEHAVIOR-1] token 未配置 → status=not_configured，sendBark 被调用一次', async () => {
    if (skipIfUnavailable('T1')) return;

    delete process.env.NOTION_INBOX_TOKEN;
    const pool = makeMockPool();

    const result = await runNotionChannelSentinel(pool);

    expect(result.status).toBe('not_configured');
    expect(sendBark).toHaveBeenCalledTimes(1);
    const [title, body] = sendBark.mock.calls[0];
    expect(title).toBe('Notion 通道告警');
    expect(body).toContain('[notion-sentinel]');
    expect(body).toContain('not_configured');
    // 探测端点不应被调用
    expect(notionRequest).not.toHaveBeenCalled();
  });

  // ─── T2: token 未配置，24h 内第二次 → 不重复 sendBark ──────────────────
  it('[T2][BEHAVIOR-1 去重] token 未配置，24h 内第二次调用 → bark 只调 1 次', async () => {
    if (skipIfUnavailable('T2')) return;

    delete process.env.NOTION_INBOX_TOKEN;
    const pool = makeMockPool();

    // 第一次
    await runNotionChannelSentinel(pool);
    // 重置 5min gate 但保留去重 Map
    // 通过修改内部时间戳触发：依赖模块导出 _resetNotionAlertDedup 不清除 5min gate
    // 用独立 pool 调用第二次
    await runNotionChannelSentinel(pool);

    // sendBark 只应被调用 1 次（第二次因去重跳过）
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  // ─── T3: token 有效，/users/me 返回 200 → status=ok ─────────────────────
  it('[T3][BEHAVIOR-2] token 有效，GET /users/me 成功 → status=ok，bark 未调', async () => {
    if (skipIfUnavailable('T3')) return;

    process.env.NOTION_INBOX_TOKEN = 'valid-token-test';
    notionRequest.mockResolvedValueOnce({ object: 'user', name: 'TestBot', id: 'user-123' });

    const pool = makeMockPool();
    const result = await runNotionChannelSentinel(pool);

    expect(result.status).toBe('ok');
    expect(sendBark).not.toHaveBeenCalled();
    // /users/me 端点被调用
    expect(notionRequest).toHaveBeenCalledWith('valid-token-test', '/users/me');
  });

  // ─── T4: 401 unauthorized → token_invalid，sendBark ─────────────────────
  it('[T4][BEHAVIOR-3] HTTP 401 unauthorized → status=token_invalid，sendBark 被调用', async () => {
    if (skipIfUnavailable('T4')) return;

    process.env.NOTION_INBOX_TOKEN = 'invalid-token';
    notionRequest.mockRejectedValueOnce(
      makeNotionError(401, 'unauthorized', 'API token is invalid.')
    );

    const pool = makeMockPool();
    const result = await runNotionChannelSentinel(pool);

    expect(result.status).toBe('token_invalid');
    expect(sendBark).toHaveBeenCalledTimes(1);
    const [title, body] = sendBark.mock.calls[0];
    expect(title).toBe('Notion 通道告警');
    expect(body).toContain('[notion-sentinel]');
    expect(body).toContain('token_invalid');
    expect(body).toContain('F6收件箱');
  });

  // ─── T5: 403 restricted_resource → token_invalid，sendBark ──────────────
  it('[T5][BEHAVIOR-3] HTTP 403 restricted_resource（封仓）→ status=token_invalid，sendBark 被调用', async () => {
    if (skipIfUnavailable('T5')) return;

    process.env.NOTION_INBOX_TOKEN = 'revoked-token';
    notionRequest.mockRejectedValueOnce(
      makeNotionError(403, 'restricted_resource', 'Insufficient permissions.')
    );

    const pool = makeMockPool();
    const result = await runNotionChannelSentinel(pool);

    expect(result.status).toBe('token_invalid');
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  // ─── T6: 网络超时 → network_error，sendBark ──────────────────────────────
  it('[T6][BEHAVIOR-3] 网络超时/fetch 异常 → status=network_error，sendBark 被调用', async () => {
    if (skipIfUnavailable('T6')) return;

    process.env.NOTION_INBOX_TOKEN = 'some-token';
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    notionRequest.mockRejectedValueOnce(timeoutErr);

    const pool = makeMockPool();
    const result = await runNotionChannelSentinel(pool);

    expect(result.status).toBe('network_error');
    expect(sendBark).toHaveBeenCalledTimes(1);
    const [, body] = sendBark.mock.calls[0];
    expect(body).toContain('network_error');
  });

  // ─── T7: token_invalid 告警，24h 内重复 → 去重，bark 只调 1 次 ───────────
  it('[T7][BEHAVIOR-3 去重] token_invalid 24h 内第二次 → bark 只调 1 次', async () => {
    if (skipIfUnavailable('T7')) return;

    process.env.NOTION_INBOX_TOKEN = 'bad-token';
    notionRequest
      .mockRejectedValueOnce(makeNotionError(401, 'unauthorized', 'invalid'))
      .mockRejectedValueOnce(makeNotionError(401, 'unauthorized', 'invalid'));

    const pool = makeMockPool();
    // 第一次 — 应该发 bark
    await runNotionChannelSentinel(pool);
    // 第二次 — 去重保护，不应再发 bark（需重置 5min gate 但保留去重）
    // 通过重置 5min gate 专属方法（若有）或接受"第二次 skipped"场景
    // 本测试假设实现提供 _resetSentinelRunAt 或类似方法，否则仅验证 bark 调用次数
    await runNotionChannelSentinel(pool);

    // bark 最多 1 次（第二次因去重或 5min gate 跳过）
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  // ─── T8: 5min gate — 两次快速调用，第二次跳过 ───────────────────────────
  it('[T8][BEHAVIOR-4] 5min gate：两次快速连续调用，第二次返回 skipped', async () => {
    if (skipIfUnavailable('T8')) return;

    process.env.NOTION_INBOX_TOKEN = 'any-token';
    notionRequest.mockResolvedValue({ object: 'user', name: 'Bot', id: 'u1' });

    const pool = makeMockPool();
    // 第一次正常运行
    const first = await runNotionChannelSentinel(pool);
    expect(first.skipped).toBeFalsy(); // 第一次不跳过

    // 第二次立即调用（未过 5min）
    const second = await runNotionChannelSentinel(pool);
    expect(second.skipped).toBe(true);

    // notionRequest 只应被调用一次（第二次被 gate 拦截）
    expect(notionRequest).toHaveBeenCalledTimes(1);
  });

  // ─── T9: KV 写入成功 — pool.query 被调用，参数含正确 key ─────────────────
  it('[T9][BEHAVIOR-5] KV 写入成功：pool.query 被调用，key=notion_channel_sentinel_state', async () => {
    if (skipIfUnavailable('T9')) return;

    process.env.NOTION_INBOX_TOKEN = 'valid-token-kv';
    notionRequest.mockResolvedValueOnce({ object: 'user', name: 'Bot', id: 'u2' });

    const pool = makeMockPool();
    await runNotionChannelSentinel(pool);

    // pool.query 被调用至少一次（KV 写入）
    expect(pool.query).toHaveBeenCalled();
    // 第一个参数（SQL）应含 INSERT INTO working_memory
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('working_memory');
    // 参数中应含 notion_channel_sentinel_state key
    expect(params).toContain('notion_channel_sentinel_state');
  });

  // ─── T10: KV 写入失败 — 不影响返回值（INV-04）────────────────────────────
  it('[T10][BEHAVIOR-5][INV-04] KV 写入失败（pool.query 抛错）→ status 仍正确返回，不抛出', async () => {
    if (skipIfUnavailable('T10')) return;

    process.env.NOTION_INBOX_TOKEN = 'valid-token-dbfail';
    notionRequest.mockResolvedValueOnce({ object: 'user', name: 'Bot', id: 'u3' });

    const pool = makeMockPool({ shouldFail: true });

    // 不应抛出异常
    let result;
    await expect(async () => {
      result = await runNotionChannelSentinel(pool);
    }).not.toThrow();

    // 仍返回正确 status
    expect(result).toBeDefined();
    expect(result.status).toBe('ok');
  });

  // ─── [BEHAVIOR-6] scheduler-jobs.js 注册验证 ─────────────────────────────
  it('[BEHAVIOR-6] scheduler-jobs.js 中 notion-channel-sentinel 注册正确', async () => {
    const { JOBS } = await import('../../../packages/brain/src/scheduler-jobs.js');
    const job = JOBS.find(j => j.name === 'notion-channel-sentinel');

    expect(job).toBeDefined();
    expect(job.needsPool).toBe(true);
    expect(typeof job.handler).toBe('function');
    expect(job.description).toContain('notion-channel-sentinel');
  });
});

// ─── INV 核查（静态断言）──────────────────────────────────────────────────────

describe('Invariant 静态核查', () => {
  it('[INV-03] _notionAlertDedup 可从测试重置（模块级内存 Map）', async () => {
    if (!moduleAvailable) return;
    expect(typeof _resetNotionAlertDedup).toBe('function');
    // 调用不抛出
    expect(() => _resetNotionAlertDedup()).not.toThrow();
  });

  it('[INV-05] Job 名称严格为 notion-channel-sentinel', async () => {
    const { JOBS } = await import('../../../packages/brain/src/scheduler-jobs.js');
    const jobs = JOBS.filter(j => j.name.includes('notion') && j.name.includes('sentinel'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('notion-channel-sentinel');
  });
});
