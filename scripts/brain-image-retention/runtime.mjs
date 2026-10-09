import { lstat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { createStore } from './storage.mjs';
import { createDockerAdapter } from './docker.mjs';
import { createDeploymentLedger } from './ledger.mjs';
import { createRetentionEngine } from './engine.mjs';
import { deployHealth, fail, US_MACHINE_ID } from './policy.mjs';
export const ROOT = '/mnt/openclaw_data/cecelia-janitor';
export async function readHealth(base = 'http://127.0.0.1:5221') {
  const response = await fetch(`${base}/api/brain/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) throw fail('DEPLOY_HEALTH_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 262144) throw fail('HEALTH_OUTPUT_LIMIT'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString());
  return deployHealth(value);
}
export async function createRuntime({ root = ROOT, dataPath, executable, health = readHealth, expectedContainerId } = {}) {
  const store = createStore(root);
  let config;
  try { config = await store.read('config.json'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!config) return null;
  if (Object.keys(config).sort().join(',') !== 'daemon_id,docker_root_dir,machine_registry_id,schema_version,volume_dev'
      || config.schema_version !== 1 || config.machine_registry_id !== US_MACHINE_ID || typeof config.daemon_id !== 'string'
      || !config.daemon_id || config.daemon_id.length > 256 || !isAbsolute(config.docker_root_dir)
      || normalize(config.docker_root_dir) !== config.docker_root_dir || !Number.isSafeInteger(config.volume_dev) || config.volume_dev < 0) throw fail('INVALID_HOST_CONFIG');
  const container = await lstat('/.dockerenv').then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
  const { schema_version, ...expected } = config;
  const docker = createDockerAdapter({ root, dataPath: dataPath ?? (container ? '/run/cecelia-docker-data' : config.docker_root_dir), expected, ...(executable ? { executable } : {}) });
  return Object.freeze({ store, docker, engine: createRetentionEngine({ store, docker }), ledger: createDeploymentLedger({ store, docker, health: expectedContainerId === undefined ? health : lease => docker.containerHealth(expectedContainerId, lease), expectedContainerId }) });
}
