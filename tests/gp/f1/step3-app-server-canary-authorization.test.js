import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rpcModule from '../../../packages/brain/scripts/fleet-worker/app-server-rpc.cjs';
import runnerModule from '../../../packages/brain/scripts/fleet-worker/app-server-runner.cjs';
import profileModule from '../../../packages/brain/scripts/fleet-worker/app-server-profile.cjs';
import { runCanaryProtocol } from '../../../packages/brain/src/app-server/canary-protocol.js';

it('F1验收许可：真实双向HTTP只封存固定元数据摘要，拒绝模型、工具与任意cwd', async () => {
  const policy = rpcModule.createRpcPolicy({ canary: true });
  const results = { initialize: { userAgent: 'codex/0.158.0' }, 'model/list': { data: [] },
    'config/read': { config: {} }, 'configRequirements/read': { requirements: null } };
  const seen = [];
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(64));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.flushHeaders();
    let input = '';
    req.on('data', chunk => {
      input += chunk;
      let end;
      while ((end = input.indexOf('\n')) >= 0) {
        const frame = JSON.parse(input.slice(0, end)); input = input.slice(end + 1);
        const accepted = policy.client(frame);
        expect(accepted.forward).toBeTruthy(); seen.push(frame.method);
        if (!frame.id) continue;
        const reply = { id: frame.id, result: results[frame.method] };
        expect(policy.server(reply).forward).toBeTruthy();
        res.write(JSON.stringify(reply) + '\n');
      }
    });
    req.on('end', () => res.end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await expect(runCanaryProtocol({ token: 'a'.repeat(64),
      stream_url: `http://127.0.0.1:${server.address().port}/app-server-streams/${randomUUID()}`,
      expires_at: Date.now() + 5000 }, { timeoutMs: 2000 })).resolves.toEqual({ complete: true });
    expect(seen).toEqual(['initialize', 'initialized', 'model/list', 'config/read', 'configRequirements/read']);
    expect(policy.canaryEvidence()).toEqual({ complete: true, rejected: 0, failed: 0,
      methods: Object.entries(results).map(([method, result]) => ({ method,
        result_digest: createHash('sha256').update(JSON.stringify(result)).digest('hex') })) });
    for (const method of ['turn/start', 'thread/start', 'command/exec']) {
      expect(policy.client({ id: 8, method, params: {} }).reply.error.message).toBe('appserver_canary_method_denied');
    }
    expect(policy.server({ id: 'tool', method: 'item/tool/call', params: { tool: 'exec' } }).reply.error.message)
      .toBe('appserver_canary_method_denied');
    const fresh = rpcModule.createRpcPolicy({ canary: true });
    expect(fresh.client({ id: 1, method: 'config/read', params: { cwd: '/private' } }).reply.error.message)
      .toBe('appserver_canary_params_denied');
    expect(policy.canaryEvidence().complete).toBe(false);
  } finally { policy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

it('F1验收身份：有效HMAC不能让旧boot许可在新Worker创建容器', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gp-canary-auth-'));
  const key = 'gp-canary-key-'.repeat(4);
  const profile = { image: `sha256:${'a'.repeat(64)}`, cpus: 1, memoryBytes: 67108864,
    pidsLimit: 16, user: '1000:1000', tmpBytes: 1048576, network: 'none',
    homeKey: 'b'.repeat(64), workspaceKey: 'c'.repeat(64) };
  const identity = { reservation_id: randomUUID(), intent_id: randomUUID(), launch_generation: 1,
    machine_id: 'gp-node', worker_id: 'gp-worker', worker_boot_id: randomUUID(),
    home_key: profile.homeKey, config_digest: profileModule.profileDigest(profile), profile: 'canary' };
  identity.owner_key = profileModule.generationOwner(identity);
  const payload = { authorization_id: randomUUID(), nonce: randomUUID(), expires_at: Date.now() + 30000, identity };
  const permit = { payload, signature: createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex') };
  let creates = 0;
  const runner = runnerModule.createAppServerRunner({ stateRoot: root, machineId: identity.machine_id,
    workerId: identity.worker_id, bootId: randomUUID(), profiles: { canary: profile }, canaryKey: key,
    assertLocalResources: async () => {}, docker: { inspect: async () => null,
      create: async () => { creates++; throw Error('unexpected create'); } } });
  try {
    await expect(runner.start({ ...identity, canary_permit: permit })).rejects.toThrow('appserver_worker_changed');
    expect(creates).toBe(0);
  } finally { runner.close(); rmSync(root, { recursive: true, force: true }); }
});
