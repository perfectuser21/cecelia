import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import runnerModule from '../../../packages/brain/scripts/fleet-worker/app-server-runner.cjs';
import profileModule from '../../../packages/brain/scripts/fleet-worker/app-server-profile.cjs';

it('F1造完真验：专用容器取消墓碑跨重启禁止迟到启动；默认没有启动能力', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gp-appserver-'));
  const profile = { image: `sha256:${'a'.repeat(64)}`, cpus: 1, memoryBytes: 67108864,
    pidsLimit: 16, user: '1000:1000', tmpBytes: 1048576, network: 'none',
    homeKey: 'b'.repeat(64), workspaceKey: 'c'.repeat(64) };
  const identity = { reservation_id: randomUUID(), intent_id: randomUUID(), launch_generation: 1,
    machine_id: 'gp-node', worker_id: 'gp-worker', worker_boot_id: randomUUID(),
    profile: 'canary', owner_key: `openclaw-${profile.homeKey}`, config_digest: profileModule.profileDigest(profile) };
  let creates = 0;
  const config = { stateRoot: root, machineId: identity.machine_id, workerId: identity.worker_id,
    bootId: identity.worker_boot_id, assertLocalResources: async () => {},
    docker: { inspect: async () => null, create: async () => { creates++; throw Error('unexpected create'); } } };
  try {
    const disabled = runnerModule.createAppServerRunner(config);
    expect(disabled.capabilities().profiles).toEqual({});
    await expect(disabled.start(identity)).rejects.toThrow('appserver_profile_unavailable');
    const enabled = runnerModule.createAppServerRunner({ ...config, profiles: { canary: profile } });
    expect(await enabled.cancel({ ...identity, container_id: null, challenge: randomUUID() }))
      .toMatchObject({ absent: true, tombstoned: true, status: 'cleaned' });
    const restarted = runnerModule.createAppServerRunner({ ...config, bootId: randomUUID() });
    await expect(restarted.start(identity)).rejects.toThrow('appserver_launch_tombstoned');
    expect(creates).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
