import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runStandaloneSkill } from './run.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const identity = { task_id: 'task-101', run_id: 'run-101' };
const cleanup = { ...identity, local_released: true, central_released: true, native_return_unknown: false };

function setup({ agentError, cleanupReceipt = cleanup, observed = { evidence: ['queue:101'], summary: '候选已入库' } } = {}) {
  const calls = [];
  return {
    calls,
    startHost: async () => {
      calls.push('startHost');
      return {
        connectionPath: '/run/connection.json',
        close: async () => { calls.push('closeHost'); return cleanupReceipt; },
      };
    },
    runAgent: async ({ connectionPath }) => {
      assert.equal(connectionPath, '/run/connection.json');
      calls.push('agent');
      if (agentError) throw agentError;
    },
    verifyBusiness: async ({ taskId, runId }) => {
      assert.deepEqual([taskId, runId], [identity.task_id, identity.run_id]);
      calls.push('verifyBusiness');
      return observed;
    },
  };
}

test('先启工具，单次 Agent 执行，读回业务证据并完成清理', async () => {
  const services = setup();
  const receipt = await runStandaloneSkill(identity, services);
  assert.deepEqual(services.calls, ['startHost', 'agent', 'verifyBusiness', 'closeHost']);
  assert.deepEqual(receipt, { ...identity, status: 'completed', evidence: ['queue:101'], summary: '候选已入库' });
});

test('Agent 失败仍清理，只读回核对原业务，结果未知保留待复核', async () => {
  const services = setup({ agentError: Error('agent_timeout'), observed: null });
  const receipt = await runStandaloneSkill(identity, services);
  assert.deepEqual(services.calls, ['startHost', 'agent', 'verifyBusiness', 'closeHost']);
  assert.equal(receipt.status, 'needs_review');
  assert.equal(receipt.reason, 'standalone_business_unconfirmed');
});

test('Agent 退出异常时，读回已经提交的原结果即可完成，无需重复执行', async () => {
  const services = setup({ agentError: Error('lost_response') });
  const receipt = await runStandaloneSkill(identity, services);
  assert.equal(receipt.status, 'completed');
  assert.equal(services.calls.filter(call => call === 'agent').length, 1);
});

test('缺少原身份的清理证据，不能报成功', async () => {
  const services = setup({ cleanupReceipt: { ...cleanup, run_id: 'different-run' } });
  const receipt = await runStandaloneSkill(identity, services);
  assert.equal(receipt.status, 'needs_review');
  assert.equal(receipt.reason, 'standalone_cleanup_unconfirmed');
  assert.deepEqual(receipt.evidence, ['queue:101']);
});

test('工具启动阶段失败，不再启动 Agent', async () => {
  const services = setup();
  services.startHost = async () => { throw Error('locked'); };
  await assert.rejects(runStandaloneSkill(identity, services), /locked/);
  assert.deepEqual(services.calls, []);
});


test('操作机入口执行固定适配器并返回结果，摘要漂移拒绝启动', () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'standalone-launch-'));
  try {
    const provider = join(directory, 'provider.mjs');
    const config = join(directory, 'config.json');
    const launcher = fileURLToPath(new URL('./launch.mjs', import.meta.url));
    const fixture = `
      export const identity = ${JSON.stringify(identity)};
      let observed = false;
      export async function startHost() {
        return {connectionPath: 'fixture-connection', close: async () => (${JSON.stringify(cleanup)})};
      }
      export async function runAgent({connectionPath}) {
        if (connectionPath !== 'fixture-connection') throw Error('wrong-connection');
        observed = true;
      }
      export async function verifyBusiness() {
        return observed ? {summary: '隔离验收', evidence: ['fixture:result']} : null;
      }
    `;
    writeFileSync(provider, fixture, { mode: 0o600 });
    writeFileSync(config, JSON.stringify({ provider, provider_sha256: createHash('sha256').update(fixture).digest('hex') }), { mode: 0o600 });
    const result = JSON.parse(execFileSync(process.execPath, [launcher, config], { encoding: 'utf8' }));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.evidence, ['fixture:result']);
    writeFileSync(provider, fixture + '\n');
    const refused = spawnSync(process.execPath, [launcher, config], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /standalone_provider_digest_mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
