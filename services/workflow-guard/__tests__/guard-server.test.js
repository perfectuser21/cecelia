import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuardServer } from '../src/server.js';

// HTTP 外壳：worker 在 M4 上够不到 Commander 账本，改成向账本所在主机要令牌。
// 它必须与 CLI 返回完全一致的结果——否则新旧不可互换，切换时会静默产生不同的 fence_token。
describe('createGuardServer', () => {
  let dir, server, base;
  const runId = 'test-run', attemptId = 'a1';
  const executionId = `${runId}:${attemptId}`;
  const leaseId = `${executionId}:lease`;
  const ledger = {
    schema_version: 2, run_id: runId, attempt_id: attemptId, execution_id: executionId,
    worker_agent_id: 'tenant-worker', lease_id: leaseId, pending_relay: null, terminal: null,
    events: [{ marker: 'WORKFLOW_EVENT', payload: {
      event: 'stage_started', event_id: `${executionId}:2`, stage_id: 'collection', stage_attempt: 2 } }],
  };
  const body = (o = {}) => ({
    run_id: runId, attempt_id: attemptId, execution_id: executionId, lease_id: leaseId,
    worker_agent_id: 'tenant-worker', stage_id: 'collection', stage_attempt: 2,
    intent: 'raw_comment_insert', ...o,
  });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardsrv-'));
    fs.writeFileSync(path.join(dir, `${runId}__${attemptId}.json`), JSON.stringify(ledger));
    server = createGuardServer({ stateDir: dir });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const post = (b, p = '/authorize') => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  });

  it('授权成功返回 200 + fence_token', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.authorized).toBe(true);
    expect(j.fence_token).toMatch(/^[a-f0-9]{64}$/);
    expect(j.commander_event_id).toBe(`${executionId}:2`);
  });

  it('拒绝返回 403 且带原因——worker 要能从原因判断是重试还是终止', async () => {
    const res = await post(body({ stage_attempt: 1 }));
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.authorized).toBe(false);
    expect(j.error).toMatch(/Stale or out-of-order/);
  });

  it('lease 不对 → 403（这是远程化后的主要鉴权面）', async () => {
    const res = await post(body({ lease_id: 'forged-lease' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/lease mismatch/);
  });

  it('账本不存在 → 403 而不是 500（跨机器最常见的情况，不该是服务端错误）', async () => {
    const res = await post(body({ run_id: 'ghost-run' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Cannot read Commander ledger/);
  });

  it('坏 JSON → 400 不崩', async () => {
    const res = await fetch(`${base}/authorize`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    expect(res.status).toBe(400);
  });

  it('GET /authorize → 405（只接受 POST）', async () => {
    expect((await fetch(`${base}/authorize`)).status).toBe(405);
  });

  it('未知路径 → 404', async () => {
    expect((await post(body(), '/whatever')).status).toBe(404);
  });

  it('/health 可探活（部署后要能自检）', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.state_dir).toBe(dir);
  });

  it('超大 body 被拒，不吃满内存', async () => {
    const res = await fetch(`${base}/authorize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body(), padding: 'x'.repeat(200_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('HTTP 与直接调用核心得到同一个 token（新旧必须可互换）', async () => {
    const { authorizeWrite } = await import('../src/guard-core.js');
    const direct = authorizeWrite({ ...body(), state_dir: dir });
    const viaHttp = await (await post(body())).json();
    expect(viaHttp.fence_token).toBe(direct.fence_token);
  });
});
