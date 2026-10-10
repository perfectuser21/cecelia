/**
 * resource-health（决策 de6dff5d 第 5 步，任务 5bf2512a）：仓库资源当下健康的纯逻辑 + 写入/查询 SQL 形状。
 * 平台通用：账号键 = <平台>:<账号 id>，获客只是测试样例。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  HEALTH_STATUSES, BLOCKING_STATUSES, accountKey, normalizeHealthReport, classifyAccountSwitch,
  collectTaskResourceRefs, reportResourceHealth, checkResourcesHealth, summarizeHealthCheck,
} from '../resource-health.js';

describe('常量与账号键', () => {
  it('五态 + 只有 offline/restricted 挡派发', () => {
    expect(HEALTH_STATUSES).toEqual(['healthy', 'degraded', 'offline', 'restricted', 'unknown']);
    expect(BLOCKING_STATUSES).toEqual(['offline', 'restricted']);
  });
  it('账号键：平台小写 + 冒号 + 账号 id；缺一个就 null', () => {
    expect(accountKey('Douyin', 'langzi63485')).toBe('douyin:langzi63485');
    expect(accountKey('', 'x')).toBeNull();
    expect(accountKey('kuaishou', '  ')).toBeNull();
  });
});

describe('normalizeHealthReport', () => {
  it('合法上报：账号用 platform+account_id 拼键，原因/证据/来源带上', () => {
    const r = normalizeHealthReport({
      resource_type: 'account', platform: 'douyin', account_id: 'a1', status: 'offline',
      reason: '切换列表消失', evidence: { screenshot: 's3://x.png' }, source: 'phone-rpa:xian-m4',
    });
    expect(r.error).toBeUndefined();
    expect(r.report).toMatchObject({
      resource_type: 'account', resource_key: 'douyin:a1', platform: 'douyin', status: 'offline',
      reason: '切换列表消失', evidence: { screenshot: 's3://x.png' }, source: 'phone-rpa:xian-m4',
    });
  });
  it('手机/仓库物件直接用 resource_key', () => {
    expect(normalizeHealthReport({ resource_type: 'phone', resource_key: 'ANGYVB4227006983', status: 'healthy', source: 'mirror' }).report)
      .toMatchObject({ resource_type: 'phone', resource_key: 'ANGYVB4227006983', evidence: {} });
  });
  it.each([
    [{ resource_type: 'phone', resource_key: 'p', status: 'broken', source: 's' }, /status/],
    [{ resource_type: 'car', resource_key: 'p', status: 'healthy', source: 's' }, /resource_type/],
    [{ resource_type: 'phone', status: 'healthy', source: 's' }, /resource_key/],
    [{ resource_type: 'phone', resource_key: 'p', status: 'healthy' }, /source/],
    [{ resource_type: 'phone', resource_key: 'p', status: 'healthy', source: 's', evidence: 'text' }, /evidence/],
    [{ resource_type: 'phone', resource_key: 'p', status: 'healthy', source: 's', evidence: { big: 'x'.repeat(20000) } }, /evidence/],
    [{ resource_type: 'phone', resource_key: 'p\n', status: 'healthy', source: 's' }, /resource_key/],
  ])('非法上报被拒 %#', (body, re) => {
    const r = normalizeHealthReport(body);
    expect(r.report).toBeUndefined();
    expect(r.error).toMatch(re);
  });
  it('不健康状态必须带原因', () => {
    expect(normalizeHealthReport({ resource_type: 'phone', resource_key: 'p', status: 'offline', source: 's' }).error).toMatch(/reason/);
  });
});

describe('classifyAccountSwitch（主理人三态判据）', () => {
  it('切换成功可用 = healthy，继续', () => {
    expect(classifyAccountSwitch('switched')).toMatchObject({ status: 'healthy', action: 'proceed' });
  });
  it('切换列表消失 = offline（掉线），停用该号', () => {
    expect(classifyAccountSwitch('list_missing')).toMatchObject({ status: 'offline', action: 'stop_using_account' });
  });
  it('切换要身份校验/人脸 = restricted（被风控），立即退出不验证', () => {
    for (const o of ['verification_required', 'face_verification']) {
      expect(classifyAccountSwitch(o)).toMatchObject({ status: 'restricted', action: 'exit_without_verification' });
    }
  });
  it('没见过的结果不猜，返回 null', () => {
    expect(classifyAccountSwitch('maybe')).toBeNull();
    expect(classifyAccountSwitch(undefined)).toBeNull();
  });
});

describe('collectTaskResourceRefs', () => {
  it('device_serial / 秋米路由手机 / account_ref / resource_refs 合并去重', () => {
    const refs = collectTaskResourceRefs({
      device_serial: 'S1',
      qiumi_route: { device_hint: { serial: 'S1' } },
      account_ref: { platform: 'douyin', account_id: 'a1' },
      resource_refs: [{ type: 'warehouse_item', key: 'openclaw_gateway' }, { resource_type: 'account', resource_key: 'douyin:a1' }, { type: 'bad' }],
    });
    expect(refs).toEqual([
      { type: 'phone', key: 'S1' },
      { type: 'account', key: 'douyin:a1' },
      { type: 'warehouse_item', key: 'openclaw_gateway' },
    ]);
  });
  it('没有资源引用 → 空数组（调用方据此零 DB 开销）', () => {
    expect(collectTaskResourceRefs({ anchor: {} })).toEqual([]);
    expect(collectTaskResourceRefs(null)).toEqual([]);
  });
  it('最多取 20 个', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ type: 'phone', key: `p${i}` }));
    expect(collectTaskResourceRefs({ resource_refs: many })).toHaveLength(20);
  });
});

describe('reportResourceHealth', () => {
  const report = { resource_type: 'account', resource_key: 'douyin:a1', platform: 'douyin', status: 'restricted',
    reason: '切换要人脸', evidence: { step: 'switch' }, source: 'phone-rpa', item_key: null, reported_at: null };

  it('单条 upsert，观测时间取库时钟 now()，回带上一状态', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'h1', status: 'restricted', previous_status: 'healthy' }] }) };
    const out = await reportResourceHealth(pool, report, { notify: vi.fn() });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO resource_health/);
    expect(sql).toMatch(/ON CONFLICT \(resource_type, resource_key\) DO UPDATE/);
    expect(sql).toMatch(/observed_at\s*=\s*now\(\)/);
    expect(params).toContain('douyin:a1');
    expect(out).toMatchObject({ changed: true, previous_status: 'healthy', current: { status: 'restricted' } });
  });

  it('状态变坏 → 调告警；告警抛错不影响写入结果', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'h1', status: 'restricted', previous_status: 'healthy' }] }) };
    const notify = vi.fn().mockRejectedValue(new Error('bark down'));
    const out = await reportResourceHealth(pool, report, { notify });
    await new Promise((r) => setImmediate(r));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'restricted' }), 'healthy');
    expect(out.changed).toBe(true);
  });

  it('状态没变 → changed=false，不告警', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'h1', status: 'restricted', previous_status: 'restricted' }] }) };
    const notify = vi.fn();
    const out = await reportResourceHealth(pool, report, { notify });
    expect(out.changed).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('item_key 查不到仓库物件 → 抛 unknown_item_key，不写库', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(reportResourceHealth(pool, { ...report, item_key: 'nope' }, { notify: vi.fn() })).rejects.toThrow(/unknown_item_key/);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('checkResourcesHealth / summarizeHealthCheck', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  it('offline/restricted 挡派发并给原因；degraded 放行但列出；没记录算 unknown 放行；过期的 healthy 标 stale', async () => {
    const rows = [
      { resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '人脸', observed_at: '2026-10-09T23:00:00Z' },
      { resource_type: 'phone', resource_key: 'S1', status: 'degraded', reason: '电量低', observed_at: '2026-10-09T23:00:00Z' },
      { resource_type: 'phone', resource_key: 'S2', status: 'healthy', reason: null, observed_at: '2026-10-01T00:00:00Z' },
    ];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const refs = [{ type: 'account', key: 'douyin:a1' }, { type: 'phone', key: 'S1' }, { type: 'phone', key: 'S2' }, { type: 'phone', key: 'S3' }];
    const out = await checkResourcesHealth(pool, refs, { now, maxAgeHours: 24 });
    expect(out.ok).toBe(false);
    expect(out.blocked).toEqual([expect.objectContaining({ type: 'account', key: 'douyin:a1', status: 'restricted', reason: '人脸' })]);
    expect(out.degraded.map((d) => d.key)).toEqual(['S1']);
    expect(out.stale.map((d) => d.key)).toEqual(['S2']);
    expect(out.unknown).toEqual([{ type: 'phone', key: 'S3' }]);
    expect(summarizeHealthCheck(out)).toMatch(/account douyin:a1 restricted（人脸）/);
  });
  it('空引用不查库，直接 ok', async () => {
    const pool = { query: vi.fn() };
    expect((await checkResourcesHealth(pool, [])).ok).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
