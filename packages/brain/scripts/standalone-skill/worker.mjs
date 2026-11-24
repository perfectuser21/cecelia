import { lstatSync, mkdirSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { durableWrite } from '../../src/orchestrator/activity-supervisor.js';
import { loadStandaloneProvider, readOwnedFile } from './launch.mjs';
import { runStandaloneSkill } from './run.mjs';

export async function runStandaloneWorkerOnce({ machineId, request, provider, receipts }) {
  const send = async receipt => {
    const result = await request('finish', { machine_id: machineId, receipt });
    const expected = receipt.status === 'completed' ? 'completed' : 'blocked';
    if (result?.status !== expected) throw Error('standalone_worker_receipt_unconfirmed');
    await receipts.sent(receipt);
  };
  const pending = await receipts.pending();
  if (pending) {
    await send(pending);
    return { status: 'reconciled' };
  }
  const { job } = await request('claim', { machine_id: machineId });
  if (!job) return { status: 'idle' };
  const identity = { task_id: job.task_id, run_id: job.run_id };
  if (job.machine_id !== machineId || !identity.task_id || !identity.run_id) throw Error('standalone_worker_claim_mismatch');
  let receipt;
  try {
    const services = await provider(job);
    receipt = await runStandaloneSkill(identity, services);
  } catch (error) {
    const known = ['standalone_provider_binding_missing','standalone_provider_profile_drift',
      'standalone_profile_mismatch','standalone_provider_toolkit_unfrozen','standalone_provider_toolkit_drift',
      'standalone_provider_brain_credentials_unavailable'];
    receipt = { ...identity, status: 'needs_review',
      reason: known.includes(error.message) ? error.message : 'standalone_start_unconfirmed', evidence: [] };
  }
  await receipts.save(receipt);
  await send(receipt);
  return { status: receipt.status };
}

function diskReceipts(directory) {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const st = lstatSync(directory);
  if (realpathSync(directory) !== directory || !st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) {
    throw Error('standalone_receipt_directory_invalid');
  }
  const pathFor = receipt => {
    if (!/^[a-f0-9-]{36}$/.test(receipt.run_id ?? '')) throw Error('standalone_receipt_run_invalid');
    return join(directory, receipt.run_id + '.json');
  };
  return {
    async pending() {
      const file = readdirSync(directory).sort().find(name => /^[a-f0-9-]{36}\.json$/.test(name) && !existsSync(join(directory, name + '.sent')));
      return file ? JSON.parse(readOwnedFile(join(directory, file))) : null;
    },
    async save(receipt) { durableWrite(pathFor(receipt), receipt); },
    async sent(receipt) { durableWrite(pathFor(receipt) + '.sent', receipt); },
  };
}

async function main(configFile) {
  const config = JSON.parse(readOwnedFile(configFile));
  const target = new URL(config.brain_url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' || !target.port
      || target.username || target.password || target.search || target.hash || !process.env.CECELIA_INTERNAL_TOKEN) {
    throw Error('standalone_worker_config_invalid');
  }
  const { createProvider } = await loadStandaloneProvider(config.provider_config);
  if (typeof createProvider !== 'function') throw Error('standalone_provider_invalid');
  return runStandaloneWorkerOnce({
    machineId: config.machine_id,
    provider: createProvider,
    receipts: diskReceipts(config.receipts_directory),
    request: async (action, body) => {
      const response = await fetch(new URL('api/brain/workflow-foundation/standalone/' + action, target), {
        method: 'POST', headers: {'content-type': 'application/json', 'x-internal-token': process.env.CECELIA_INTERNAL_TOKEN},
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) throw Error('standalone_worker_brain_' + response.status);
      return response.json();
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('standalone_config_required');
    process.stdout.write(JSON.stringify(await main(process.argv[2])) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: /^standalone_[a-z0-9_]+$/.test(error.message) ? error.message : 'standalone_worker_unconfirmed' }) + '\n');
    process.exitCode = 1;
  }
}
