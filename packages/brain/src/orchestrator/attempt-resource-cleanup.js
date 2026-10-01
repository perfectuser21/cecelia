import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPrimaryWorker } from '../machine-registry.js';
import { createProductionExecutionTransport } from './production-transport.js';

const execFileAsync = promisify(execFile);

async function inspectLocalContainer(containerId) {
  try {
    await execFileAsync('docker', ['inspect', '--format', '{{.Name}}', containerId], { timeout: 5000 });
    return true;
  } catch (error) {
    // An unreachable daemon or generic inspect failure proves nothing.
    if (error.code === 1 && String(error.stderr).trim() === `Error: No such object: ${containerId}`) return false;
    throw error;
  }
}

export async function confirmExpiredParentCleanup(parent, {
  env = process.env, launcher, transportFactory = createProductionExecutionTransport,
  removeContainer, inspectContainer = inspectLocalContainer, fetchFn,
} = {}) {
  const machine = parent.actual_machine_id ?? parent.machine_id ?? parent.requested_machine_id;
  const legacy = parent.local_container_naming === 'legacy-unsuffixed';
  const local = parent.execution_transport === 'local-docker';
  if (legacy || local) {
    if (!isPrimaryWorker(machine) || !isPrimaryWorker(env.CECELIA_MACHINE_ID)) {
      return { status: 'unsupported', reason: 'legacy_cleanup_wrong_host' };
    }
    if (!/^[a-f0-9-]{36}$/i.test(parent.id)) return { status: 'unsupported', reason: 'legacy_cleanup_identity_invalid' };
    let containerId;
    if (legacy) containerId = `cecelia-harness-${parent.id.replaceAll('-', '').slice(0, 8)}`;
    else {
      const { localContainerIdForAttempt } = await import('./dispatcher.js');
      containerId = localContainerIdForAttempt(parent.id, parent.lease_generation);
    }
    if (!containerId) return { status: 'unsupported', reason: 'legacy_cleanup_identity_invalid' };
    const remove = removeContainer ?? (await import('../spawn/detached.js')).removeDockerContainer;
    if (await remove(containerId) !== true || await inspectContainer(containerId) !== false) {
      return { status: 'unavailable', reason: 'legacy_cleanup_unconfirmed' };
    }
    return { status: 'cleaned', attempt_id: parent.id };
  }
  const transport = launcher ?? transportFactory({ env, fetchFn, remoteBridgeTimeoutMs: 20_000 });
  return transport.cancel({ attempt: parent, target: { machine } });
}
