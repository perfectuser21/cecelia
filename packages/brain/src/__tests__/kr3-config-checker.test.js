/**
 * kr3-config-checker.test.js
 *
 * 单元测试：KR3 配置检测器使用正确的 decisions 表列名（topic/decision）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock db.js 避免真实 DB 连接
vi.mock('../db.js', () => ({ default: null }));

const { checkKR3ConfigDB, markWxPayConfigured, markAdminOidInitialized } =
  await import('../kr3-config-checker.js');

function makeMockPool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

describe('checkKR3ConfigDB', () => {
  it('未配置时返回 false × 2', async () => {
    const pool = makeMockPool([]);
    const result = await checkKR3ConfigDB(pool);
    expect(result.wxPayConfigured).toBe(false);
    expect(result.adminOidReady).toBe(false);
    expect(result.summary).toContain('WX_PAY ❌');
    expect(result.summary).toContain('AdminOID ❌');
  });

  it('查询使用 topic 列而非 key 列', async () => {
    const pool = makeMockPool([]);
    await checkKR3ConfigDB(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('topic');
    expect(sql).not.toContain(' key ');
    expect(sql).not.toContain("'key'");
  });

  it('WX_PAY 已配置时返回 wxPayConfigured=true', async () => {
    const pool = makeMockPool([
      { topic: 'kr3_wx_pay_configured', decision: '商户号已配置', updated_at: new Date('2026-04-14') },
    ]);
    const result = await checkKR3ConfigDB(pool);
    expect(result.wxPayConfigured).toBe(true);
    expect(result.wxPayNote).toBe('商户号已配置');
    expect(result.adminOidReady).toBe(false);
  });

  it('AdminOID 已初始化时返回 adminOidReady=true', async () => {
    const pool = makeMockPool([
      { topic: 'kr3_admin_oid_initialized', decision: '已调用bootstrapAdmin', updated_at: new Date('2026-04-14') },
    ]);
    const result = await checkKR3ConfigDB(pool);
    expect(result.adminOidReady).toBe(true);
    expect(result.adminOidNote).toBe('已调用bootstrapAdmin');
  });

  it('两项全就绪时 allReady 计算正确', async () => {
    const pool = makeMockPool([
      { topic: 'kr3_wx_pay_configured', decision: '已配置', updated_at: new Date('2026-04-14') },
      { topic: 'kr3_admin_oid_initialized', decision: '已初始化', updated_at: new Date('2026-04-14') },
    ]);
    const result = await checkKR3ConfigDB(pool);
    expect(result.wxPayConfigured).toBe(true);
    expect(result.adminOidReady).toBe(true);
  });
});

describe('markWxPayConfigured', () => {
  it('使用 topic/decision 列执行 UPDATE + INSERT（不用 key/value）', async () => {
    const pool = makeMockPool([]);
    await markWxPayConfigured(pool, '商户号12345678');

    expect(pool.query).toHaveBeenCalledTimes(2);
    const updateSql = pool.query.mock.calls[0][0];
    const insertSql = pool.query.mock.calls[1][0];

    expect(updateSql).toContain('UPDATE decisions');
    expect(updateSql).toContain('topic');
    expect(updateSql).not.toContain(' key ');

    expect(insertSql).toContain('INSERT INTO decisions');
    expect(insertSql).toContain('topic');
    expect(insertSql).toContain('decision');
    expect(insertSql).not.toContain(' key ');
    expect(insertSql).not.toContain(' value ');
  });
});

describe('markAdminOidInitialized', () => {
  it('使用 topic/decision 列执行 UPDATE + INSERT（不用 key/value）', async () => {
    const pool = makeMockPool([]);
    await markAdminOidInitialized(pool, '已初始化');

    expect(pool.query).toHaveBeenCalledTimes(2);
    const updateSql = pool.query.mock.calls[0][0];
    const insertSql = pool.query.mock.calls[1][0];

    expect(updateSql).toContain('UPDATE decisions');
    expect(updateSql).toContain('topic');

    expect(insertSql).toContain('INSERT INTO decisions');
    expect(insertSql).toContain('topic');
    expect(insertSql).toContain('decision');
  });
});
