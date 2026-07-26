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

  it('initiative_runs insert failure after spawn still cleans the exact snapshot identity', async () => {
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
    expect(deps.cleanupCodexHome).toHaveBeenCalledWith(containerId);
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
