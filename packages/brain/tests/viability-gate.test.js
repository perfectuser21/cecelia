/**
 * viability-gate.test.js
 *
 * 验证 Dispatch Viability Gate 核心逻辑。
 * 使用 vi.mock 隔离外部依赖（pool / account-usage / alerting）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 外部依赖 ─────────────────────────────────────────────────────────────
vi.mock('../src/db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

let _authFailedSet = new Set();
vi.mock('../src/account-usage.js', () => ({
  isAuthFailed: (id) => _authFailedSet.has(id),
}));

// ── 被测模块（在 mock 注册之后 import）────────────────────────────────────────
const { checkDispatchViability, alertOnViabilityBlock } = await import('../src/viability-gate.js');

// ── 辅助：构造 mock pool ──────────────────────────────────────────────────────
function makePool(wechatFailCount = 0) {
  return { query: vi.fn().mockResolvedValue({ rows: [{ cnt: wechatFailCount }] }) };
}

describe('checkDispatchViability', () => {
  beforeEach(() => {
    _authFailedSet = new Set();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // content_publish 路径
  // ─────────────────────────────────────────────────────────────────────────

  it('content_publish 缺 platform → viable=false', async () => {
    const task = { id: 't1', task_type: 'content_publish', payload: {} };
    const r = await checkDispatchViability(task, makePool());
    expect(r.viable).toBe(false);
    expect(r.check).toBe('content_publish_platform_missing');
  });

  it('content_publish 未知 platform → viable=false', async () => {
    const task = { id: 't2', task_type: 'content_publish', payload: { platform: 'tiktok', export_path: '/x' } };
    const r = await checkDispatchViability(task, makePool());
    expect(r.viable).toBe(false);
    expect(r.check).toBe('content_publish_platform_unknown');
  });

  it('content_publish 缺 export_path → viable=false', async () => {
    const task = { id: 't3', task_type: 'content_publish', payload: { platform: 'douyin' } };
    const r = await checkDispatchViability(task, makePool());
    expect(r.viable).toBe(false);
    expect(r.check).toBe('content_publish_export_path_missing');
  });

  it('content_publish export_path 为空字符串 → viable=false', async () => {
    const task = { id: 't4', task_type: 'content_publish', payload: { platform: 'weibo', export_path: '   ' } };
    const r = await checkDispatchViability(task, makePool());
    expect(r.viable).toBe(false);
    expect(r.check).toBe('content_publish_export_path_missing');
  });

  it('wechat auth_fail cnt ≥ 阈值 → viable=false', async () => {
    const task = { id: 't5', task_type: 'content_publish', payload: { platform: 'wechat', export_path: '/nas/a.zip' } };
    const r = await checkDispatchViability(task, makePool(3));
    expect(r.viable).toBe(false);
    expect(r.check).toBe('wechat_auth_fail_storm');
    expect(r.reason).toContain('3');
  });

  it('wechat auth_fail cnt < 阈值 → viable=true', async () => {
    const task = { id: 't6', task_type: 'content_publish', payload: { platform: 'wechat', export_path: '/nas/b.zip' } };
    const r = await checkDispatchViability(task, makePool(1));
    expect(r.viable).toBe(true);
  });

  it('wechat auth_fail DB 查询失败 → fail-open（不阻断）', async () => {
    const brokenPool = { query: vi.fn().mockRejectedValue(new Error('db offline')) };
    const task = { id: 't7', task_type: 'content_publish', payload: { platform: 'wechat', export_path: '/nas/c.zip' } };
    const r = await checkDispatchViability(task, brokenPool);
    expect(r.viable).toBe(true);
  });

  it('douyin 合法 platform + export_path → viable=true', async () => {
    const task = { id: 't8', task_type: 'content_publish', payload: { platform: 'douyin', export_path: '/nas/d.zip' } };
    const r = await checkDispatchViability(task, makePool(0));
    expect(r.viable).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // account_id auth 熔断路径
  // ─────────────────────────────────────────────────────────────────────────

  it('payload.account_id auth 熔断 → viable=false', async () => {
    _authFailedSet.add('account3');
    const task = { id: 't9', task_type: 'dev', payload: { account_id: 'account3' } };
    const r = await checkDispatchViability(task, makePool(0));
    expect(r.viable).toBe(false);
    expect(r.check).toBe('account_auth_failed');
    expect(r.reason).toContain('account3');
  });

  it('payload.account_id 正常 → viable=true', async () => {
    const task = { id: 't10', task_type: 'dev', payload: { account_id: 'account1' } };
    const r = await checkDispatchViability(task, makePool(0));
    expect(r.viable).toBe(true);
  });

  it('无 account_id 的普通任务 → viable=true', async () => {
    const task = { id: 't11', task_type: 'dev', payload: {} };
    const r = await checkDispatchViability(task, makePool(0));
    expect(r.viable).toBe(true);
  });

  it('talk 类型任务（无外部服务依赖）→ viable=true', async () => {
    const task = { id: 't12', task_type: 'talk', payload: { prd_summary: '记录进展' } };
    const r = await checkDispatchViability(task, makePool(0));
    expect(r.viable).toBe(true);
  });
});

describe('alertOnViabilityBlock', () => {
  it('调用成功不抛异常', async () => {
    const { raise } = await import('../src/alerting.js');
    const task = { id: 'ta1', title: '测试任务' };
    const result = { viable: false, check: 'wechat_auth_fail_storm', reason: '...' };
    await expect(alertOnViabilityBlock(null, task, result)).resolves.toBeUndefined();
    expect(raise).toHaveBeenCalledWith('P2', 'viability_gate_wechat_auth_fail_storm', expect.stringContaining('测试任务'));
  });

  it('alerting 失败时 fail-open（不抛异常）', async () => {
    const { raise } = await import('../src/alerting.js');
    raise.mockRejectedValueOnce(new Error('feishu down'));
    const task = { id: 'ta2', title: '告警失败测试' };
    const result = { viable: false, check: 'content_publish_platform_missing', reason: '...' };
    await expect(alertOnViabilityBlock(null, task, result)).resolves.toBeUndefined();
  });
});
