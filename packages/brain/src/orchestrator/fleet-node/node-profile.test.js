import { describe, expect, it } from 'vitest';

const CANONICAL_IDS = ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'];
const EXPECTED_CAPACITIES = {
  'us-mac-m4': 7,
  'xian-mac-m4': 8,
  'xian-mac-m1': 8,
};
const EXPECTED_WORKER_BIND_HOSTS = {
  'us-mac-m4': '127.0.0.1',
  'xian-mac-m4': '100.86.57.69',
  'xian-mac-m1': '100.88.166.55',
};

async function loadContract() {
  const loaded = await import('./node-profile.js').catch(() => ({}));
  expect(loaded.listNodeProfiles, 'missing NodeProfile registry entrypoint').toBeTypeOf('function');
  expect(loaded.getNodeProfile, 'missing fail-closed NodeProfile lookup').toBeTypeOf('function');
  expect(loaded.getRoleCapacity, 'missing role-weight capacity calculator').toBeTypeOf('function');
  return loaded;
}

describe('Fleet NodeProfile registry', () => {
  it('contains exactly the three canonical machines and their frozen capacities', async () => {
    const { listNodeProfiles } = await loadContract();
    const profiles = listNodeProfiles();

    expect(profiles.map((profile) => profile.machine_id)).toEqual(CANONICAL_IDS);
    expect(Object.fromEntries(profiles.map((profile) => [
      profile.machine_id,
      profile.capacity,
    ]))).toEqual(EXPECTED_CAPACITIES);
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(profiles.every((profile) => Object.isFrozen(profile))).toBe(true);
    for (const profile of profiles) {
      expect(Object.isFrozen(profile.resources)).toBe(true);
      expect(Object.isFrozen(profile.launchd)).toBe(true);
      expect(Object.isFrozen(profile.version_policy)).toBe(true);
    }
  });

  it('pins one immutable sha256 Runner digest and never admits a floating tag', async () => {
    const { listNodeProfiles } = await loadContract();
    const profiles = listNodeProfiles();
    const digests = new Set(profiles.map((profile) => profile.runner_image_digest));

    expect(digests.size).toBe(1);
    const [digest] = digests;
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digest).not.toMatch(/latest/i);
    expect(() => {
      profiles[0].runner_image_digest = 'runner:latest';
    }).toThrow();
    expect(() => {
      profiles[0].resources.cpu_cores = 999;
    }).toThrow();
    expect(() => {
      profiles[0].launchd.domain = 'gui/501';
    }).toThrow();
    expect(() => {
      profiles[0].version_policy.node = 'latest';
    }).toThrow();
    expect(() => {
      profiles.push({ machine_id: 'moon-base' });
    }).toThrow();
  });

  it('requires the shared resource floor, disk guard, and system LaunchDaemon', async () => {
    const { listNodeProfiles } = await loadContract();

    for (const profile of listNodeProfiles()) {
      expect(profile.resources).toEqual({
        cpu_cores: 6,
        memory_gib: 8,
        disk_min_free_gib: 40,
        disk_max_used_percent: 85,
        cpu_pressure_max_percent: expect.any(Number),
        memory_pressure_max_percent: expect.any(Number),
      });
      expect(Number.isFinite(profile.resources.cpu_pressure_max_percent)).toBe(true);
      expect(profile.resources.cpu_pressure_max_percent).toBeGreaterThan(0);
      expect(profile.resources.cpu_pressure_max_percent).toBeLessThan(100);
      expect(Number.isFinite(profile.resources.memory_pressure_max_percent)).toBe(true);
      expect(profile.resources.memory_pressure_max_percent).toBeGreaterThan(0);
      expect(profile.resources.memory_pressure_max_percent).toBeLessThan(100);
      expect(profile.launchd).toMatchObject({
        domain: 'system',
        kind: 'LaunchDaemon',
      });
    }
  });

  it('pins a loopback US listener and exact Xian Tailscale listeners', async () => {
    const { listNodeProfiles } = await loadContract();
    const profiles = listNodeProfiles();

    expect(Object.fromEntries(profiles.map((profile) => [
      profile.machine_id,
      profile.worker_bind_host,
    ]))).toEqual(EXPECTED_WORKER_BIND_HOSTS);
    expect(profiles[0].worker_bind_host).toBe('127.0.0.1');
    for (const profile of profiles.slice(1)) {
      expect(profile.worker_bind_host).not.toBe('127.0.0.1');
      expect(profile.worker_bind_host).not.toBe('0.0.0.0');
    }
  });

  it('defines non-empty policies for every admission-controlled software surface', async () => {
    const { listNodeProfiles } = await loadContract();
    const policyKeys = [
      'os',
      'orbstack',
      'worker_protocol',
      'worker_contract',
      'worker',
      'runner',
      'git',
      'node',
      'codex',
    ];

    for (const profile of listNodeProfiles()) {
      expect(Object.keys(profile.version_policy).sort()).toEqual(policyKeys.sort());
      for (const key of policyKeys) {
        expect(profile.version_policy[key], `${profile.machine_id}.${key}`).toBeTypeOf('string');
        expect(profile.version_policy[key].trim().length).toBeGreaterThan(0);
      }
      expect(Object.isFrozen(profile.version_policy)).toBe(true);
    }
  });

  it('fails closed for unknown, empty, and non-string machine identities', async () => {
    const { getNodeProfile } = await loadContract();

    for (const machineId of ['moon-base', '', null, undefined, 42]) {
      expect(() => getNodeProfile(machineId)).toThrow(/unknown_fleet_node/);
    }
  });

  it.each([
    ['commander', 1, 8],
    ['planner', 1, 8],
    ['reviewer', 1, 8],
    ['proposer', 2, 4],
    ['generator', 4, 2],
    ['evaluator', 4, 2],
    ['judge', 4, 2],
    ['reporter', 1, 8],
  ])('applies the %s role weight %i to eight base slots', async (role, weight, expected) => {
    const { getRoleCapacity } = await loadContract();
    expect(getRoleCapacity({ baseCapacity: 8, role })).toEqual({
      role,
      weight,
      capacity: expected,
    });
  });

  it('fails closed for unknown, empty, and non-string roles', async () => {
    const { getRoleCapacity } = await loadContract();

    for (const role of ['observer', '', null, undefined, 42]) {
      expect(() => getRoleCapacity({ baseCapacity: 8, role })).toThrow(
        /unknown_fleet_role/,
      );
    }
  });

  it('rejects duplicate identities in a candidate NodeProfile registry', async () => {
    const loaded = await import('./node-profile.js');
    expect(
      loaded.validateNodeProfileRegistry,
      'missing registry schema validator',
    ).toBeTypeOf('function');
    const profiles = structuredClone(loaded.listNodeProfiles());
    profiles[2].machine_id = profiles[1].machine_id;

    expect(() => loaded.validateNodeProfileRegistry(profiles)).toThrow(
      /invalid_fleet_node_registry/,
    );
  });
});
