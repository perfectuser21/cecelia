import { afterEach, expect, it, vi } from 'vitest';
import { createGoldenPathAuditStore } from '../golden-path-audit-store.js';
import { recordGoldenPathHttp, setGoldenPathAudit, startGoldenPathAudit } from '../golden-path-audit-runtime.js';

const input = { method: 'POST', route: '/golden_path/:id/run-result', path_kind: 'write', allowed: false };
const payload = { audit_id: 'audit', window_id: 'isolated-request-only', observation_mode: 'isolated_request_only' };
afterEach(() => { setGoldenPathAudit(null); vi.restoreAllMocks(); });

it.each(['cecelia', 'cecelia_test_production', '', undefined])('实际DB身份%s拒绝，不靠pool/env标签写生产或未知库', async name => {
  const query = vi.fn(async statement => ({ rows: statement.text === 'SELECT current_database() AS name' ? [{ name }] : [] }));
  const release = vi.fn(), unrelatedQuery = vi.fn();
  const pool = { query: unrelatedQuery, connect: async () => ({ query, release }) };
  const result = await recordGoldenPathHttp(input, { pool, env: { NODE_ENV: 'test', DB_NAME: 'cecelia_test' } });
  expect(result).toEqual({ persisted: false, reason: 'gp_isolated_database_unproven' });
  expect(unrelatedQuery).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([s]) => /cecelia_events|advisory|COMMIT/.test(s.text))).toBe(false);
  expect(query.mock.calls.at(-1)[0].text).toBe('ROLLBACK'); expect(release).toHaveBeenCalledWith(false);
});

it('缺显式pool或非隔离runtime无请求审计，隔离startup无后台DB/timer', async () => {
  const pool = { connect: vi.fn(), query: vi.fn() }, timer = vi.spyOn(globalThis, 'setInterval');
  expect(await recordGoldenPathHttp(input, { env: { NODE_ENV: 'test' } })).toEqual({ persisted: false, reason: 'gp_runtime_not_started' });
  expect(await recordGoldenPathHttp(input, { pool, env: { NODE_ENV: 'production', DB_NAME: 'cecelia' } })).toEqual({ persisted: false, reason: 'gp_runtime_not_started' });
  expect(await startGoldenPathAudit({ pool, env: { NODE_ENV: 'test' } })).toEqual({ disabled: true });
  expect(pool.connect).not.toHaveBeenCalled(); expect(pool.query).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
});

it('隔离选项不能发行T0、生命周期、正式window/source或instance，拒绝在连接前', async () => {
  const pool = { connect: vi.fn() }, store = createGoldenPathAuditStore(pool);
  for (const [type, body] of [
    ['golden_path_observation_t0', payload], ['golden_path_observation_health', payload],
    ['golden_path_legacy_access', { ...payload, window_id: 'formal' }],
    ['golden_path_legacy_access', { ...payload, source: {} }],
    ['golden_path_legacy_access', { ...payload, instance_id: 'instance' }],
  ]) await expect(store.persist(type, body, { isolatedRequestOnly: true })).rejects.toThrow('gp_isolated_payload_invalid');
  expect(pool.connect).not.toHaveBeenCalled();
});

it('既有生产observer存在时沿持久journal路径，不降级被动审计', async () => {
  const recordHttp = vi.fn(async () => ({ persisted: false, reason: 'real_gap' })), pool = { connect: vi.fn() };
  setGoldenPathAudit({ recordHttp });
  expect(await recordGoldenPathHttp(input, { pool, env: { NODE_ENV: 'test' } })).toEqual({ persisted: false, reason: 'real_gap' });
  expect(recordHttp).toHaveBeenCalledWith(input); expect(pool.connect).not.toHaveBeenCalled();
});
