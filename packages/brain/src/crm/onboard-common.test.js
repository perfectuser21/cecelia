import { describe, it, expect, vi } from 'vitest';
import { hash, transaction, activeBinding, contactLock } from './onboard-common.js';

describe('好友入档公共边界', () => {
  it('配置摘要忽略对象键顺序但保留数组顺序与授权值', () => {
    const first = { fields: { allowed: ['a', 'b'], name: '客户' }, enabled: true };
    expect(hash(first)).toBe(hash({ enabled: true, fields: { name: '客户', allowed: ['a', 'b'] } }));
    expect(hash(first)).not.toBe(hash({ ...first, enabled: false }));
    expect(hash(first)).not.toBe(hash({ ...first, fields: { ...first.fields, allowed: ['b', 'a'] } }));
  });
  it('事务失败回滚并释放池连接，不提交部分入档', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const pool = { totalCount: 1, connect: vi.fn().mockResolvedValue(client) };
    const failure = new Error('写入失败');
    await expect(transaction(pool, async tx => { await tx.query('INSERT receipt'); throw failure; })).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'INSERT receipt', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  it('已有客户端直接提交，不取得或释放其他连接', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(transaction(db, async tx => { expect(tx).toBe(db); return '已提交'; })).resolves.toBe('已提交');
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
  });
  it.each([[[], 'not_found'], [[{ enabled: false }], 'binding_disabled']])('绑定不存在或禁用时按租户限定并拒绝', async (rows, code) => {
    const db = { query: vi.fn().mockResolvedValue({ rows }) };
    await expect(activeBinding(db, 'tenant-a', 'binding-a')).rejects.toMatchObject({ code });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('tenant_id=$1 AND id=$2 FOR SHARE'), ['tenant-a', 'binding-a']);
  });
  it('所有联系人写入口使用租户、我方账号、原生联系人共同锁域', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await contactLock(db, 'tenant-a', 'account-a', 'contact-a');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['crm-contact:tenant-a:account-a:contact-a']);
  });
});
