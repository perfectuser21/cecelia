import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _setActiveCodexRelays,
  snapshotCodexRelayHome,
  spawnSkillRelaySession,
} from '../harness-skill-relay.js';
import * as relayModule from '../harness-skill-relay.js';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function codexTask(index) {
  const hex = index.toString(16).padStart(8, '0');
  return {
    id: `${hex}-cccc-4ddd-8eee-ffff00000000`,
    title: `Codex team1 controller ${index}`,
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      sprint_dir: `sprints/codex-four-way-${index}`,
    },
  };
}

function poolWithActiveCount(count = 0) {
  return {
    query: vi.fn(async (sql) => {
      if (/SELECT COUNT\(\*\)/.test(sql)) {
        return { rows: [{ count: String(count) }] };
      }
      return { rows: [] };
    }),
  };
}

function execWithLiveCodexCount(count) {
  const names = Array.from(
    { length: count },
    (_, index) => `cecelia-relay-${(index + 100).toString(16).padStart(8, '0')}-cx-${(index + 200).toString(16).padStart(8, '0')}`,
  ).join('\n');
  return vi.fn((cmd) => cmd.includes('--format') ? names : '');
}

function makeDeps(overrides = {}) {
  return {
    pool: poolWithActiveCount(0),
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
    loadSkill: vi.fn().mockReturnValue('SKILL'),
    ensureWt: vi.fn(async ({ taskId }) => `/tmp/wt/${taskId}`),
    resolveAccountFn: vi.fn(),
    snapshotCodexHome: vi.fn((_home, containerId) =>
      `/Users/administrator/claude-output/codex-relay-credentials/${containerId}`),
    cleanupCodexHome: vi.fn(),
    removeContainerFn: vi.fn().mockResolvedValue(true),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    execFn: vi.fn().mockReturnValue(''),
    randomFn: vi.fn().mockReturnValue(0.123456789),
    now: () => new Date('2026-07-26T01:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('CODEX_RELAY_HOME', '/Users/administrator/.codex-team1');
});

afterEach(() => {
  _setActiveCodexRelays(0);
  vi.unstubAllEnvs();
});

describe('One Session Codex total concurrency is four on the same team1 account', () => {
  it.each([
    ['0 active rows allow launch', 0, true],
    ['3 active rows allow launch', 3, true],
    ['4 active rows defer launch', 4, false],
  ])('%s', async (_label, activeCount, allowed) => {
    const deps = makeDeps({ pool: poolWithActiveCount(activeCount) });

    const result = await spawnSkillRelaySession(codexTask(activeCount + 1), deps);

    expect(result.ok).toBe(allowed);
    expect(result.deferred === true).toBe(!allowed);
    expect(deps.spawnFn).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it('DB guard failure is fail-closed so the hard limit cannot be exceeded', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) throw new Error('db unavailable');
        return { rows: [] };
      }),
    };
    const deps = makeDeps({ pool });

    const result = await spawnSkillRelaySession(codexTask(10), deps);

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('four live exact-name Docker relays block launch even when DB has zero active rows', async () => {
    const deps = makeDeps({
      pool: poolWithActiveCount(0),
      execFn: execWithLiveCodexCount(4),
    });

    const result = await spawnSkillRelaySession(codexTask(11), deps);

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('Docker capacity counts only complete headless Codex relay names', async () => {
    const malformedNames = [
      'cecelia-relay-deadbeef-cx-11111111-extra',
      'prefix-cecelia-relay-deadbeef-cx-22222222',
      'cecelia-relay-short-cx-33333333',
      'cecelia-relay-deadbeef-cx-nothex00',
    ].join('\n');
    const deps = makeDeps({
      pool: poolWithActiveCount(3),
      execFn: vi.fn((cmd) => cmd.includes('--format') ? malformedNames : ''),
    });

    const result = await spawnSkillRelaySession(codexTask(17), deps);

    expect(result.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('one Docker-only orphan leaves exactly three launch reservations', async () => {
    let release;
    const launchBarrier = new Promise((resolve) => { release = resolve; });
    const spawnFn = vi.fn(() => launchBarrier);
    const deps = makeDeps({
      pool: poolWithActiveCount(0),
      execFn: execWithLiveCodexCount(1),
      spawnFn,
    });

    const firstThree = [12, 13, 14].map((index) =>
      spawnSkillRelaySession(codexTask(index), deps));
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(3));

    const fourthPromise = spawnSkillRelaySession(codexTask(15), deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ containerId: 'released' });
    await Promise.all(firstThree);
    const fourth = await fourthPromise;

    expect(fourth).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it('Docker capacity query failure is fail-closed', async () => {
    const deps = makeDeps({
      execFn: vi.fn(() => {
        throw new Error('docker unavailable');
      }),
    });

    const result = await spawnSkillRelaySession(codexTask(16), deps);

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('four simultaneous team1 launches reserve slots; the fifth defers', async () => {
    let release;
    const launchBarrier = new Promise((resolve) => { release = resolve; });
    const spawnFn = vi.fn(() => launchBarrier);
    const deps = makeDeps({ spawnFn });

    const firstFour = [1, 2, 3, 4].map((index) =>
      spawnSkillRelaySession(codexTask(index), deps));
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(4));

    const fifthPromise = spawnSkillRelaySession(codexTask(5), deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ containerId: 'released' });

    const firstFourResults = await Promise.all(firstFour);
    const fifth = await fifthPromise;

    expect(firstFourResults.every((result) => result.ok)).toBe(true);
    expect(fifth).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(spawnFn).toHaveBeenCalledTimes(4);
  });

  it('launch reservation releases after spawn failure', async () => {
    const failing = makeDeps({
      spawnFn: vi.fn().mockRejectedValue(new Error('docker unavailable')),
    });
    const failed = await spawnSkillRelaySession(codexTask(20), failing);
    expect(failed.ok).toBe(false);

    const retry = makeDeps();
    const result = await spawnSkillRelaySession(codexTask(21), retry);
    expect(result.ok).toBe(true);
    expect(retry.spawnFn).toHaveBeenCalledOnce();
  });
});

describe('Each headless Codex run has independent assembly', () => {
  it('four team1 runs receive unique container, callback, snapshot, and worktree identities', async () => {
    const randomValues = [0.11, 0.22, 0.33, 0.44];
    const deps = makeDeps({
      randomFn: vi.fn(() => randomValues.shift()),
    });

    const results = [];
    for (const index of [31, 32, 33, 34]) {
      results.push(await spawnSkillRelaySession(codexTask(index), deps));
    }

    expect(results.every((result) => result.ok)).toBe(true);
    const calls = deps.spawnFn.mock.calls.map(([options]) => options);
    expect(new Set(calls.map(({ containerId }) => containerId)).size).toBe(4);
    expect(new Set(calls.map(({ env }) => env.HARNESS_CALLBACK_URL)).size).toBe(4);
    expect(new Set(deps.snapshotCodexHome.mock.calls.map(([, runId]) => runId)).size).toBe(4);
    expect(new Set(deps.ensureWt.mock.calls.map(([options]) => options.taskId)).size).toBe(4);
    for (const options of calls) {
      expect(options.containerId).toMatch(/^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/);
      expect(options.extraMounts[0]).toContain(
        `/codex-relay-credentials/${options.containerId}:/home/cecelia/.codex:rw`,
      );
    }
  });
});

describe('Codex credential snapshot lifecycle', () => {
  it('snapshot lives in host-visible root with 0700 directory and 0600 auth', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'codex-relay-contract-'));
    const source = join(sandbox, 'source');
    const hostVisibleRoot = join(sandbox, 'host-visible');
    const containerId = 'cecelia-relay-deadbeef-cx-1234abcd';
    mkdirSync(source, { recursive: true });
    mkdirSync(hostVisibleRoot, { recursive: true });
    chmodSync(hostVisibleRoot, 0o700);
    writeFileSync(join(source, 'auth.json'), '{"tokens":{"access_token":"secret"}}');
    vi.stubEnv('CODEX_RELAY_SNAPSHOT_ROOT', hostVisibleRoot);

    let snapshot;
    try {
      snapshot = snapshotCodexRelayHome(source, containerId);
      expect(snapshot).toBe(join(hostVisibleRoot, containerId));
      expect(statSync(snapshot).mode & 0o777).toBe(0o700);
      expect(statSync(join(snapshot, 'auth.json')).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(snapshot, 'auth.json'), 'utf8')).toContain('secret');
    } finally {
      rmSync(snapshot || '', { recursive: true, force: true });
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('snapshot forces 0700 before copy even under a restrictive process umask', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'codex-relay-umask-contract-'));
    const source = join(sandbox, 'source');
    const hostVisibleRoot = join(sandbox, 'host-visible');
    const containerId = 'cecelia-relay-deadbeef-cx-87654321';
    mkdirSync(source, { recursive: true });
    mkdirSync(hostVisibleRoot, { recursive: true });
    chmodSync(hostVisibleRoot, 0o700);
    writeFileSync(join(source, 'auth.json'), '{"tokens":{"access_token":"secret"}}');
    vi.stubEnv('CODEX_RELAY_SNAPSHOT_ROOT', hostVisibleRoot);

    try {
      let snapshot;
      const previousUmask = process.umask(0o777);
      try {
        snapshot = snapshotCodexRelayHome(source, containerId);
      } finally {
        process.umask(previousUmask);
      }
      expect(statSync(snapshot).mode & 0o777).toBe(0o700);
      expect(statSync(join(snapshot, 'auth.json')).mode & 0o777).toBe(0o600);
    } finally {
      const partial = join(hostVisibleRoot, containerId);
      if (existsSync(partial)) chmodSync(partial, 0o700);
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('spawn failure cleans the exact snapshot identity', async () => {
    const snapshotCodexHome = vi.fn((_home, containerId) =>
      `/Users/administrator/claude-output/codex-relay-credentials/${containerId}`);
    const cleanupCodexHome = vi.fn();
    const deps = makeDeps({
      snapshotCodexHome,
      cleanupCodexHome,
      spawnFn: vi.fn().mockRejectedValue(new Error('docker unavailable')),
    });

    const result = await spawnSkillRelaySession(codexTask(40), deps);

    expect(result.ok).toBe(false);
    const containerId = snapshotCodexHome.mock.calls[0][1];
    expect(containerId).toMatch(/^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/);
    expect(cleanupCodexHome).toHaveBeenCalledWith(containerId);
  });

  it('initiative_runs insert failure removes the exact spawned container before cleanup', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) {
          return { rows: [{ count: '0' }] };
        }
        if (/INSERT INTO initiative_runs/.test(sql)) {
          throw new Error('initiative_runs unavailable');
        }
        return { rows: [] };
      }),
    };
    const deps = makeDeps({ pool });

    const result = await spawnSkillRelaySession(codexTask(41), deps);

    expect(result.ok).toBe(false);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const containerId = deps.snapshotCodexHome.mock.calls[0][1];
    expect(deps.removeContainerFn).toHaveBeenCalledWith(containerId);
    expect(deps.removeContainerFn.mock.invocationCallOrder[0]).toBeLessThan(
      deps.cleanupCodexHome.mock.invocationCallOrder[0],
    );
    expect(deps.cleanupCodexHome).toHaveBeenCalledWith(containerId);
  });

  it('failed exact removal remains capacity-visible through Docker after process state resets', async () => {
    const insertFailurePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) {
          return { rows: [{ count: '0' }] };
        }
        if (/INSERT INTO initiative_runs/.test(sql)) {
          throw new Error('initiative_runs unavailable');
        }
        return { rows: [] };
      }),
    };
    const removeContainerFn = vi.fn().mockResolvedValue(false);
    const cleanupCodexHome = vi.fn();
    const failedDeps = makeDeps({
      pool: insertFailurePool,
      removeContainerFn,
      containerStateFn: vi.fn().mockResolvedValue('present'),
      cleanupCodexHome,
    });

    const failed = await spawnSkillRelaySession(codexTask(42), failedDeps);
    expect(failed.ok).toBe(false);
    expect(cleanupCodexHome).not.toHaveBeenCalled();

    // 模拟 Brain 重启：进程内 reservation 清零，但存活容器仍是外部真相。
    _setActiveCodexRelays(0);
    let release;
    const launchBarrier = new Promise((resolve) => { release = resolve; });
    const spawnFn = vi.fn(() => launchBarrier);
    const restartDeps = makeDeps({
      pool: poolWithActiveCount(0),
      execFn: execWithLiveCodexCount(1),
      spawnFn,
    });
    const firstThree = [43, 44, 45].map((index) =>
      spawnSkillRelaySession(codexTask(index), restartDeps));
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(3));
    const blockedPromise = spawnSkillRelaySession(codexTask(46), restartDeps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ containerId: 'released' });
    await Promise.all(firstThree);
    const blocked = await blockedPromise;

    expect(blocked).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'codex_concurrent_limit',
    });
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it('an already-absent container never strands process capacity after rm returns false', async () => {
    const insertFailurePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) {
          return { rows: [{ count: '0' }] };
        }
        if (/INSERT INTO initiative_runs/.test(sql)) {
          throw new Error('initiative_runs unavailable');
        }
        return { rows: [] };
      }),
    };
    const failedDeps = makeDeps({
      pool: insertFailurePool,
      removeContainerFn: vi.fn().mockResolvedValue(false),
    });
    const failed = await spawnSkillRelaySession(codexTask(47), failedDeps);
    const containerId = failedDeps.snapshotCodexHome.mock.calls[0][1];
    expect(failed.ok).toBe(false);
    expect(failedDeps.execFn).toHaveBeenCalledWith(
      `docker ps -a --filter "name=^/${containerId}$" --format "{{.Names}}"`,
    );
    expect(failedDeps.cleanupCodexHome).toHaveBeenCalledWith(containerId);

    _setActiveCodexRelays(0);
    const recoveredDeps = makeDeps({
      pool: poolWithActiveCount(3),
      execFn: execWithLiveCodexCount(0),
    });
    const recovered = await spawnSkillRelaySession(codexTask(48), recoveredDeps);

    expect(recovered.ok).toBe(true);
  });

  it('unknown container state after rm failure preserves the exact snapshot', async () => {
    const insertFailurePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT COUNT\(\*\)/.test(sql)) {
          return { rows: [{ count: '0' }] };
        }
        if (/INSERT INTO initiative_runs/.test(sql)) {
          throw new Error('initiative_runs unavailable');
        }
        return { rows: [] };
      }),
    };
    const deps = makeDeps({
      pool: insertFailurePool,
      removeContainerFn: vi.fn().mockResolvedValue(false),
      containerStateFn: vi.fn().mockRejectedValue(new Error('docker daemon unavailable')),
    });

    const failed = await spawnSkillRelaySession(codexTask(49), deps);

    expect(failed.ok).toBe(false);
    expect(deps.cleanupCodexHome).not.toHaveBeenCalled();
  });

  it('terminal fallback removes only complete matching IDs for this task', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'codex-relay-terminal-contract-'));
    const snapshotRoot = join(sandbox, 'snapshots');
    const realHome = join(sandbox, '.codex-team1');
    const matching = [
      'cecelia-relay-deadbeef-cx-11111111',
      'cecelia-relay-deadbeef-cx-22222222',
    ];
    const untouched = [
      'cecelia-relay-feedface-cx-33333333',
      'cecelia-relay-deadbeef-cx-nothex00',
      'cecelia-relay-deadbeef-cx-44444444-extra',
    ];
    mkdirSync(snapshotRoot, { recursive: true });
    mkdirSync(realHome, { recursive: true });
    writeFileSync(join(realHome, 'auth.json'), 'real-team1-secret');
    for (const name of [...matching, ...untouched]) {
      mkdirSync(join(snapshotRoot, name));
      writeFileSync(join(snapshotRoot, name, 'auth.json'), name);
    }
    vi.stubEnv('CODEX_RELAY_SNAPSHOT_ROOT', snapshotRoot);

    try {
      expect(typeof relayModule.cleanupCodexRelaySnapshotsForTask).toBe('function');
      const removed = relayModule.cleanupCodexRelaySnapshotsForTask(
        'deadbeef-cccc-4ddd-8eee-ffff00000000',
      );

      expect(removed.sort()).toEqual(matching.sort());
      for (const name of matching) expect(existsSync(join(snapshotRoot, name))).toBe(false);
      for (const name of untouched) expect(existsSync(join(snapshotRoot, name))).toBe(true);
      expect(readFileSync(join(realHome, 'auth.json'), 'utf8')).toBe('real-team1-secret');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('Production wiring stays team1-only', () => {
  it('compose mounts only team1 and defaults CODEX_RELAY_HOME to team1', () => {
    const compose = readFileSync(
      new URL('../../../../docker-compose.yml', import.meta.url),
      'utf8',
    );

    expect(compose).toContain(
      '/Users/administrator/.codex-team1:/Users/administrator/.codex-team1:ro',
    );
    for (const account of ['team2', 'team3', 'team4', 'team5']) {
      expect(compose).not.toContain(
        `/Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
    }
    expect(compose).toContain(
      'CODEX_RELAY_HOME=${CODEX_RELAY_HOME:-${HOME}/.codex-team1}',
    );
  });
});
