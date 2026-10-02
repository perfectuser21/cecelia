import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveProfile, updateAgentModel, _resetProfileCache } from '../model-profile.js';

function database({ stale = false, missing = false, eventError = false } = {}) {
  const original = { id: 'profile-test', name: '测试', is_active: true,
    config: { thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' } } };
  let stored = structuredClone(original);
  const query = vi.fn(async (sql, values) => {
    if (sql.startsWith('SELECT')) return { rows: [structuredClone(stored)] };
    if (sql.startsWith('UPDATE')) {
      if (missing) return { rows: [], rowCount: 0 };
      stored.config = stale ? original.config : JSON.parse(values[0]);
      return { rows: [structuredClone(stored)], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO cecelia_events')) {
      if (eventError) throw new Error('事件账不可用');
      return { rows: [{ id: 'event-test', created_at: new Date() }] };
    }
    if (sql === 'ROLLBACK') stored = structuredClone(original);
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(async () => client), client, original, stored: () => stored };
}

describe('单Agent模型修改闭环', () => {
  beforeEach(() => _resetProfileCache());

  it('数据库读回一致且事件提交后才返回已验证回执', async () => {
    const pool = database();
    const result = await updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001',
      { actor: 'dashboard', sessionId: 'session-test' });
    expect(result.receipt).toMatchObject({ verified: true, actor: 'dashboard',
      previous: { model: 'MiniMax-M2.1' }, current: { model: 'claude-haiku-4-5-20251001' } });
    expect(result.receipt.id).toBeTruthy();
    const event = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cecelia_events'));
    expect(JSON.parse(event[1][0])).toMatchObject({ agent_id: 'thalamus', session_id: 'session-test', verified: true });
    expect(pool.query.mock.calls.map(([sql]) => sql)).toContain('COMMIT');
    expect(getActiveProfile().config.thalamus.model).toBe('claude-haiku-4-5-20251001');
    expect(pool.client.release).toHaveBeenCalled();
  });

  it.each([{ stale: true }, { missing: true }])('实际未写入时拒绝成功并回滚 %j', async options => {
    const pool = database(options);
    await expect(updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001')).rejects.toThrow(/验证|冲突/);
    expect(pool.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO cecelia_events'))).toBe(false);
    expect(getActiveProfile().id).not.toBe('profile-test');
  });

  it('写事件失败时模型修改一起回滚，不更新运行缓存', async () => {
    const pool = database({ eventError: true });
    await expect(updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001')).rejects.toThrow('事件账不可用');
    expect(pool.stored().config).toEqual(pool.original.config);
    expect(getActiveProfile().id).not.toBe('profile-test');
  });
});
