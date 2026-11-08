/** 默认PR只验证实际恢复器的行数/错误回执；真实竞态交私有PG，不能由这些预造结果证明SQL。 */
import { afterEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ forbidden: vi.fn(() => { throw new Error('禁止触文件/进程/锁'); }) }));
vi.mock('child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('node:child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('node:fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('../utils/cleanup-lock.js', () => ({ withLock: boundary.forbidden }));
import { cleanupStaleClaims } from '../startup-recovery.js';
const snapshot = { id: 'aaaaaaaa-0000-0000-0000-000000000001', claimed_by: 'old-owner',
  claimed_at: new Date(0), status: 'queued', claim_version: '42' };
afterEach(() => { expect(boundary.forbidden).not.toHaveBeenCalled(); });

it('SELECT见到过期行但真实UPDATE返回零行时，不能以候选数量冒充已清理', async () => {
  const query = vi.fn()
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({ rows: [snapshot] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] });
  expect(await cleanupStaleClaims({ query })).toEqual({ cleaned: 0, errors: [] });
  expect(query).toHaveBeenCalledTimes(3);
});
it('后续过期UPDATE失败时，保留已成功self清理数量并明确带错误', async () => {
  const query = vi.fn()
    .mockResolvedValueOnce({ rowCount: 2, rows: [{ status: 'queued' }, { status: 'paused' }] })
    .mockResolvedValueOnce({ rows: [snapshot] })
    .mockRejectedValueOnce(new Error('owned stale update rejected'));
  expect(await cleanupStaleClaims({ query })).toEqual({ cleaned: 2, errors: ['owned stale update rejected'] });
  expect(query).toHaveBeenCalledTimes(3);
});
