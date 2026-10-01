import { describe, it, expect, vi } from 'vitest';
import { runPhoneRegistrySync, buildPhoneAgentCommand } from '../phone-registry-sync.js';
const page = { id: 'p1', properties: { '类型': { select: { name: '安卓手机' } },
  '序列号': { rich_text: [{ plain_text: 'SER1' }] }, '名称': { title: [{ plain_text: '新昵称' }] },
  '账号': { rich_text: [{ plain_text: '抖音：测试号(id123)【当前】' }] } } };
const phone = { serial: 'SER1', nickname: '旧昵称', aliases: [], host: 'xian-m1', profile: 'p1', enabled: true,
  douyin_accounts: [], updated_at: new Date('2026-01-01'), model: 'REAL' };
function fixture(state = {}) {
  const calls = []; const client = { release: vi.fn(), query: vi.fn(async (sql, params = []) => {
    if (typeof sql === 'object') { params = sql.values ?? []; sql = sql.text; }
    calls.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('SELECT value_json')) return { rows: [{ value_json: state }] };
    if (sql.includes('FROM phone_registry')) return { rows: [phone] };
    if (sql.includes('FROM tasks')) return { rows: [] };
    if (sql.startsWith('UPDATE phone_registry')) return { rows: [{ ...phone, nickname: '新昵称' }] };
    return { rows: [] };
  }) };
  return { pool: { connect: vi.fn(async () => client) }, client, calls };
}
describe('台账同步调度', () => {
  it('完整分页读取后同事务写字段/被覆盖值/基线，提交后经mmv下发', async () => {
    const f = fixture(); const req = vi.fn().mockResolvedValueOnce({ results: [], has_more: true, next_cursor: 'cursor' })
      .mockResolvedValueOnce({ results: [page], has_more: false });
    const exec = vi.fn(async cmd => { expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(true); expect(cmd).toContain('mmv'); return JSON.stringify({ ok: true, receipts: [] }); });
    const out = await runPhoneRegistrySync(f.pool, { token: 'test', notionReq: req, exec, now: 1900000000000, program: 'print("fixture")', inContainer: false });
    expect(out.updated).toBe(1); expect(exec).toHaveBeenCalledTimes(2);
    expect(req.mock.calls[1][3].start_cursor).toBe('cursor');
    const event = f.calls.find(c => c.sql.includes('INSERT INTO task_events'));
    expect(JSON.parse(event.params[2])).toMatchObject({ actor: 'phone-registry-sync', before: { nickname: '旧昵称' } });
    expect(f.client.release).toHaveBeenCalled();
  });
  it('Notion失败/截断分页不写台账也不下发，不把缺页当删行', async () => {
    const f = fixture(); const exec = vi.fn();
    await expect(runPhoneRegistrySync(f.pool, { token: 'test', notionReq: vi.fn(async () => ({ results: [], has_more: true })), exec })).rejects.toThrow(/分页/);
    expect(f.calls.some(c => c.sql.startsWith('UPDATE phone_registry'))).toBe(false); expect(exec).not.toHaveBeenCalled();
  });
  it('30分钟成功间隔与并发advisory lock都必须保留', async () => {
    const now = 1900000000000; const f = fixture({ completed_at: new Date(now - 1000).toISOString() });
    expect(await runPhoneRegistrySync(f.pool, { token: 'test', now })).toMatchObject({ skipped: 'interval_gate' });
    const other = fixture(); other.client.query.mockResolvedValue({ rows: [{ locked: false }] });
    expect(await runPhoneRegistrySync(other.pool, { token: 'test', now })).toMatchObject({ skipped: 'locked' });
  });
  it('SSH失败不记录下发成功，并保留已提交的基线供重试', async () => {
    const f = fixture(); const out = await runPhoneRegistrySync(f.pool, { token: 'test', notionReq: async () => ({ results: [page] }),
      exec: async () => { throw Error('offline'); }, now: 1900000000000, program: 'fixture', inContainer: false, bark: vi.fn() });
    expect(out.failed).toHaveLength(2); expect(out.ok).toBe(false);
    expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(true);
    const states = f.calls.filter(c => c.sql.includes('INSERT INTO working_memory')).map(c => JSON.parse(c.params[1]));
    expect(states.at(-1)).not.toHaveProperty('completed_at');
    expect(states.at(-1).baselines.SER1).toBeTruthy();
  });
  it('远程数据不内插shell，host仅固定执行机白名单', () => {
    const cmd = buildPhoneAgentCommand('xian-m1', { phones: [{ nickname: "$(touch /tmp/nope)'" }] }, 'fixture', false);
    expect(cmd).not.toContain('$(touch'); expect(() => buildPhoneAgentCommand('bad; command', {}, '', false)).toThrow();
  });
  it('Notion请求挂起必须限时解锁，无写入或下一页请求', async () => {
    const f = fixture(); const req = vi.fn(() => new Promise(() => {})); const exec = vi.fn();
    await expect(runPhoneRegistrySync(f.pool, { token: 'test', notionReq: req, exec, notionTimeoutMs: 20 })).rejects.toThrow(/超时/);
    expect(req).toHaveBeenCalledTimes(1);
    expect(f.calls.some(c => c.sql === 'BEGIN')).toBe(false);
    expect(f.calls.some(c => c.sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(f.client.release).toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  }, 250);
  it.each(['unknown_account', 'unreadable', 'unreachable', 'cleanup_failed'])('核验%s必须去重提醒，忙碌手机仍仅延后核验', async (status) => {
    const f = fixture(); const bark = vi.fn();
    const exec = vi.fn(async cmd => JSON.stringify({ ok: true, receipts: [
      { serial: 'SER1', day: '2030-01-01', status: cmd.includes('xian-m1') ? status : 'task_busy' },
    ] }));
    const out = await runPhoneRegistrySync(f.pool, { token: 'test', notionReq: async () => ({ results: [] }), exec,
      now: 1900000000000, program: 'fixture', inContainer: false, bark });
    expect(out.ok).toBe(false); expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][2]).toMatchObject({ dedupeKey: 'phone-account:SER1:2030-01-01', dedupeTtlSec: 86400 });
  });

});
