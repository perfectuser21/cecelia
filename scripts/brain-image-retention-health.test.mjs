import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { deployHealth } from './brain-image-retention/policy.mjs';
import { readHealth } from './brain-image-retention/runtime.mjs';

// /health 的 healthy 要求 tick 循环在跑；tick 被有意封停（决策 751f73be）时恒为 degraded，
// 部署收账（finish）要求 healthy → 每次部署"容器换成功、收账失败、台账 pending 卡死后续全部部署"
// （2026-10-04 实证：03:49 起 Gate 3 全红，DEPLOYMENT_PENDING）。
const SHA = 'a'.repeat(40);
const sealed = (over = {}) => ({
  status: 'degraded', version: '1.2.3', git_sha: SHA,
  organs: { scheduler: { status: 'stopped', enabled: false }, circuit_breaker: { status: 'recovering', open: [], half_open: ['cecelia-run'] } },
  docker_runtime: { enabled: false, status: 'disabled' },
  fleet_transport: { enabled: true, status: 'ready' },
  ...over,
});

test('healthy 原样通过', () => {
  assert.deepEqual(deployHealth({ status: 'healthy', version: '1.2.3', git_sha: SHA, other: 'x' }), { status: 'healthy', version: '1.2.3', git_sha: SHA });
});

test('degraded 唯一原因是调度器被有意关闭 → 折算为 healthy（只回 status/version/git_sha）', () => {
  assert.deepEqual(deployHealth(sealed()), { status: 'healthy', version: '1.2.3', git_sha: SHA });
  // half_open 断路器不算故障（与 /health 的 healthy 公式一致：只看 OPEN）
});

test('调度器没被有意关闭（enabled=true 却没在跑）仍判 degraded', () => {
  const v = sealed({ organs: { scheduler: { status: 'stopped', enabled: true }, circuit_breaker: { open: [] } } });
  assert.equal(deployHealth(v).status, 'degraded');
});

test('有断路器 OPEN / docker 不健康 / fleet 不可用 → 即使调度器封停也仍判 degraded', () => {
  assert.equal(deployHealth(sealed({ organs: { scheduler: { enabled: false }, circuit_breaker: { open: ['cecelia-run'] } } })).status, 'degraded');
  assert.equal(deployHealth(sealed({ docker_runtime: { enabled: true, status: 'unhealthy' } })).status, 'degraded');
  assert.equal(deployHealth(sealed({ fleet_transport: { enabled: true, status: 'unavailable' } })).status, 'degraded');
});

test('缺 organs 字段（旧版本/形状不明）不折算，保守判原状态', () => {
  assert.equal(deployHealth({ status: 'degraded', version: '1.2.3', git_sha: SHA }).status, 'degraded');
  assert.equal(deployHealth({ status: 'degraded', version: '1.2.3', git_sha: SHA, organs: { scheduler: {} } }).status, 'degraded');
  assert.equal(deployHealth({ status: 'critical', version: '1.2.3', git_sha: SHA, organs: { scheduler: { enabled: false } } }).status, 'critical');
});

test('折算不改 version/git_sha：收账仍要它们与部署身份逐项相符', () => {
  const out = deployHealth(sealed({ version: '9.9.9', git_sha: 'b'.repeat(40) }));
  assert.equal(out.version, '9.9.9');
  assert.equal(out.git_sha, 'b'.repeat(40));
});

test('真实 HTTP：readHealth 对封停 tick 的 degraded 响应返回 healthy', async (t) => {
  const server = createServer((_req, res) => res.end(JSON.stringify(sealed())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await readHealth(url), { status: 'healthy', version: '1.2.3', git_sha: SHA });
});
