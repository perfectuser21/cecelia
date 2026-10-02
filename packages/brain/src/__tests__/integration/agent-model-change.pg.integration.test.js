import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateAgentModel, _resetProfileCache, getActiveProfile } from '../../model-profile.js';

// 单连接临时表遮蔽同名表；不修改真实配置和事件。数据库仍限制在测试/本地scratch库。
const database = process.env.DB_NAME || 'cecelia_scratch';
if (!['cecelia_scratch', 'cecelia_test', 'cecelia_ci'].includes(database)) {
  throw new Error('模型变更验证仅允许隔离测试数据库');
}
const client = new pg.Client({ host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432), database,
  user: process.env.DB_USER || process.env.USER, password: process.env.DB_PASSWORD || '' });
const pool = { query: (...args) => client.query(...args),
  connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };

beforeAll(async () => {
  await client.connect();
  await client.query('CREATE TEMP TABLE model_profiles (id text PRIMARY KEY, name text, config jsonb, is_active boolean, updated_at timestamptz)');
  await client.query("CREATE TEMP TABLE cecelia_events (id serial, event_type text, source text, payload jsonb CHECK (payload->>'actor' <> 'blocked'), created_at timestamptz DEFAULT now())");
});
afterAll(async () => { _resetProfileCache(); await client.end(); });

describe('真实Postgres模型配置与事件闭环', () => {
  it('数据库配置、运行缓存和可查询事件一致；事件失败则配置回滚', async () => {
    const original = { thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' } };
    await client.query('INSERT INTO model_profiles VALUES ($1, $2, $3, true, NOW())', ['isolated', '隔离验证', original]);
    const result = await updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001', { actor: 'dashboard' });
    const { rows: [stored] } = await client.query('SELECT config FROM model_profiles');
    const { rows: [event] } = await client.query('SELECT payload FROM cecelia_events WHERE payload->>\'id\' = $1', [result.receipt.id]);
    expect(stored.config.thalamus).toEqual(result.current);
    expect(getActiveProfile().config).toEqual(stored.config);
    expect(event.payload).toMatchObject({ actor: 'dashboard', verified: true,
      previous: original.thalamus, current: result.current });
    await expect(updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001',
      { actor: 'blocked', provider: 'anthropic-api' })).rejects.toThrow(/check constraint/);
    const { rows: [after] } = await client.query('SELECT config FROM model_profiles');
    expect(after.config).toEqual(stored.config);
    expect(getActiveProfile().config).toEqual(stored.config);
    expect((await client.query('SELECT count(*)::int AS n FROM cecelia_events')).rows[0].n).toBe(1);
  });
});
