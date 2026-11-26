import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runStandaloneWorkerOnce } from './worker.mjs';

const job = { machine_id: 'mac-studio', task_id: 'task-101', run_id: 'run-101' };
const receipt = { task_id: job.task_id, run_id: job.run_id, status: 'completed', summary: '已读回', evidence: ['fixture:101'] };

test('worker CLI 把私有配置的 Brain 地址传给受信 provider', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'standalone-brain-url-'));
  const runId = '778fdc67-ec2f-4e14-b590-226402d1cf5a';
  const cliJob = { ...job, run_id: runId };
  const actions = [];
  const server = createServer(async (request, response) => {
    const action = request.url.split('/').at(-1);
    actions.push(action);
    let body = '';
    for await (const chunk of request) body += chunk;
    const value = action === 'claim' ? { job: cliJob }
      : action === 'authority' ? { evidence: 'fixture:authority' }
      : { status: JSON.parse(body).receipt.status === 'completed' ? 'completed' : 'blocked' };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(value));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const provider = join(directory, 'provider.mjs');
    const providerSource = `export async function createProvider(job, options, { brainUrl } = {}) {
      const response = await fetch(new URL('/authority', brainUrl));
      if (!response.ok) throw Error('authority');
      const { evidence } = await response.json();
      return {
        startHost: async () => ({
          connectionPath: 'fixture',
          close: async () => ({ task_id: job.task_id, run_id: job.run_id, local_released: true, central_released: true, native_return_unknown: false }),
        }),
        runAgent: async () => {},
        verifyBusiness: async () => ({ summary: '已读回', evidence: [evidence] }),
      };
    }`;
    const write = (path, contents) => writeFileSync(path, contents, { mode: 0o600 });
    write(provider, providerSource);
    const providerConfig = join(directory, 'provider.json');
    write(providerConfig, JSON.stringify({
      provider, provider_sha256: createHash('sha256').update(providerSource).digest('hex'),
    }));
    const config = join(directory, 'worker.json');
    write(config, JSON.stringify({
      brain_url: 'http://127.0.0.1:' + server.address().port,
      machine_id: cliJob.machine_id, provider_config: providerConfig,
      receipts_directory: join(directory, 'receipts'),
    }));
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./worker.mjs', import.meta.url)), config,
    ], { env: { ...process.env, CECELIA_INTERNAL_TOKEN: 'fixture', BRAIN_URL: 'http://127.0.0.1:1' }, timeout: 5000 });
    assert.deepEqual(JSON.parse(stdout), { status: 'completed' });
    assert.deepEqual(actions, ['claim', 'authority', 'finish']);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('宿主领取后只执行一次，回执中断时下一轮只重送同一份回执', async () => {
  let saved, executions = 0;
  const actions = [];
  const options = {
    machineId: job.machine_id,
    request: async (action, body) => {
      actions.push(action);
      if (action === 'claim') return { job };
      assert.deepEqual(body.receipt, receipt);
      if (actions.length === 2) throw Error('network disconnected');
      return { status: 'completed' };
    },
    provider: async incoming => {
      assert.deepEqual(incoming, job);
      return {
        startHost: async () => ({
          connectionPath: 'fixture',
          close: async () => ({ task_id: job.task_id, run_id: job.run_id, local_released: true, central_released: true, native_return_unknown: false }),
        }),
        runAgent: async () => { executions++; },
        verifyBusiness: async () => ({ summary: receipt.summary, evidence: receipt.evidence }),
      };
    },
    receipts: {
      pending: async () => saved,
      save: async result => { saved = result; },
      sent: async () => { saved = undefined; },
    },
  };
  await assert.rejects(runStandaloneWorkerOnce(options), /network disconnected/);
  assert.deepEqual(await runStandaloneWorkerOnce(options), { status: 'reconciled' });
  assert.equal(executions, 1);
  assert.deepEqual(actions, ['claim', 'finish', 'finish']);
});

test('宿主无法证明启动结果时回写需复核', async () => {
  let receipt;
  const result = await runStandaloneWorkerOnce({
    machineId: job.machine_id,
    request: async action => action === 'claim' ? { job } : { status: 'blocked' },
    provider: async () => { throw Error('host unresolved'); },
    receipts: {
      pending: async () => null,
      save: async result => { receipt = result; },
      sent: async () => {},
    },
  });
  assert.deepEqual(result, { status: 'needs_review' });
  assert.equal(receipt.reason, 'standalone_start_unconfirmed');
});
