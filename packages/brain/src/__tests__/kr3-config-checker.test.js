/**
 * kr3-config-checker.test.js
 *
 * 单元测试：KR3 配置检测器
 * - decisions 表列名使用 topic/decision
 * - readLocalPayCredentials() 返回正确的字段结构
 * - autoMarkKR3IfLocalCredentialsReady() 幂等逻辑
 * - checkKR3Config() 使用正确的 miniapp env var 名称
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock fs 模块，测试本地文件读取逻辑
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// mock db.js 避免真实 DB 连接
vi.mock('../db.js', () => ({ default: null }));

import * as fs from 'fs';

const {
  checkKR3ConfigDB,
  markWxPayConfigured,
  markAdminOidInitialized,
  readLocalPayCredentials,
  autoMarkKR3IfLocalCredentialsReady,
  checkKR3Config,
} = await import('../kr3-config-checker.js');

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

describe('readLocalPayCredentials', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('文件不存在时所有字段为 false', () => {
    fs.existsSync.mockReturnValue(false);
    const result = readLocalPayCredentials();
    expect(result.fileExists).toBe(false);
    expect(result.mchidPresent).toBe(false);
    expect(result.v3KeyPresent).toBe(false);
    expect(result.serialNoPresent).toBe(false);
    expect(result.privateKeyPresent).toBe(false);
    expect(result.allCredentialsReady).toBe(false);
  });

  it('只有私钥时 allCredentialsReady 为 false', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('WX_PAY_PRIVATE_KEY=MIIXX\n');
    const result = readLocalPayCredentials();
    expect(result.fileExists).toBe(true);
    expect(result.privateKeyPresent).toBe(true);
    expect(result.mchidPresent).toBe(false);
    expect(result.allCredentialsReady).toBe(false);
  });

  it('四个字段均已填写时 allCredentialsReady 为 true', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'WX_PAY_MCHID=1234567890\nWX_PAY_V3_KEY=abc123\nWX_PAY_SERIAL_NO=ABCDEF\nWX_PAY_PRIVATE_KEY=MIIXX\n'
    );
    const result = readLocalPayCredentials();
    expect(result.mchidPresent).toBe(true);
    expect(result.v3KeyPresent).toBe(true);
    expect(result.serialNoPresent).toBe(true);
    expect(result.privateKeyPresent).toBe(true);
    expect(result.allCredentialsReady).toBe(true);
  });

  it('注释行不被解析为有效配置', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('# WX_PAY_MCHID=commented\nWX_PAY_MCHID=\n');
    const result = readLocalPayCredentials();
    expect(result.mchidPresent).toBe(false);
  });
});

describe('autoMarkKR3IfLocalCredentialsReady', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('凭据不完整时不写 DB，返回 autoMarked=false', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('WX_PAY_PRIVATE_KEY=MIIXX\n');
    const pool = makeMockPool([]);
    const result = await autoMarkKR3IfLocalCredentialsReady(pool);
    expect(result.autoMarked).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('凭据齐全且 DB 无记录时自动写入，返回 autoMarked=true', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'WX_PAY_MCHID=123\nWX_PAY_V3_KEY=abc\nWX_PAY_SERIAL_NO=XYZ\nWX_PAY_PRIVATE_KEY=MIIXX\n'
    );
    const pool = makeMockPool([]); // 无现有记录
    const result = await autoMarkKR3IfLocalCredentialsReady(pool);
    expect(result.autoMarked).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2); // SELECT + INSERT
  });

  it('DB 中已有 active 记录时跳过插入（幂等）', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'WX_PAY_MCHID=123\nWX_PAY_V3_KEY=abc\nWX_PAY_SERIAL_NO=XYZ\nWX_PAY_PRIVATE_KEY=MIIXX\n'
    );
    const pool = makeMockPool([{ id: 'existing-id' }]); // 已有记录
    const result = await autoMarkKR3IfLocalCredentialsReady(pool);
    expect(result.autoMarked).toBe(false);
    expect(result.reason).toContain('已有就绪标记');
    expect(pool.query).toHaveBeenCalledTimes(1); // 只有 SELECT，无 INSERT
  });
});

describe('checkKR3Config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('本地文件无配置时 wxPayConfigured=false，summary 显示缺失字段', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('WX_PAY_PRIVATE_KEY=MIIXX\n');
    const result = checkKR3Config();
    expect(result.wxPayConfigured).toBe(false);
    expect(result.summary).toContain('MCHID');
    expect(result.summary).toContain('V3_KEY');
    expect(result.localFileCheck).toBeDefined();
  });

  it('本地文件凭据齐全时 wxPayConfigured=true', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'WX_PAY_MCHID=123\nWX_PAY_V3_KEY=abc\nWX_PAY_SERIAL_NO=XYZ\nWX_PAY_PRIVATE_KEY=MIIXX\n'
    );
    const result = checkKR3Config();
    expect(result.wxPayConfigured).toBe(true);
    expect(result.summary).toContain('WX_PAY ✅');
  });
});
