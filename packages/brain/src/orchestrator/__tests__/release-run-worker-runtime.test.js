import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildReleaseWorkerEnvironment,
  runLeasedReleaseRoutes,
} from '../../../../../scripts/lib/release-run-worker-runtime.mjs';
import {
  cleanupPrivateReleaseWorkerConfig,
  createPrivateReleaseWorkerConfig,
  cleanupStalePrivateReleaseWorkerConfigs,
  readPrivateReleaseWorkerConfig,
} from '../release-run-worker-secret.js';

describe('leased ReleaseRun worker runtime', () => {
  it('renews before and throughout routes, then writes one terminal outcome', async () => {
    const order = [];
    let releaseRoute;
    const routePending = new Promise((resolve) => {
      releaseRoute = resolve;
    });
    const renew = vi.fn(async () => order.push('renew'));
    const appendOutcome = vi.fn(async (_claim, _generation, outcome) => {
      order.push(`outcome:${outcome}`);
    });
    const afterTerminal = vi.fn(async () => order.push('status:success'));
    const runRoute = vi.fn(async () => {
      order.push('route:start');
      await routePending;
      order.push('route:end');
    });

    const running = runLeasedReleaseRoutes({
      routes: [{ artifact: 'brain' }],
      claimId: 21,
      generation: 3,
      renew,
      appendOutcome,
      afterTerminal,
      runRoute,
      renewalIntervalMs: 5,
    });
    await vi.waitFor(() => expect(renew.mock.calls.length).toBeGreaterThan(1));
    expect(appendOutcome).not.toHaveBeenCalled();
    releaseRoute();
    await running;

    expect(order.at(0)).toBe('renew');
    expect(order).toContain('route:start');
    expect(order).toContain('route:end');
    expect(order.at(-2)).toBe('outcome:dispatched');
    expect(order.at(-1)).toBe('status:success');
    expect(appendOutcome).toHaveBeenCalledTimes(1);
  });

  it('fails closed on renewal loss and never reports dispatched', async () => {
    const appendOutcome = vi.fn(async () => {});
    const renew = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('lease lost'));

    await expect(runLeasedReleaseRoutes({
      routes: [{ artifact: 'brain' }],
      claimId: 21,
      generation: 3,
      renew,
      appendOutcome,
      runRoute: async () => new Promise((resolve) => setTimeout(resolve, 15)),
      renewalIntervalMs: 2,
    })).rejects.toThrow('release_worker_lease_lost');

    expect(appendOutcome).toHaveBeenCalledWith(21, 3, 'failed', {
      error_code: 'release_worker_lease_lost',
    });
    expect(appendOutcome).not.toHaveBeenCalledWith(
      21,
      3,
      'dispatched',
      expect.anything(),
    );
  });

  it('constructs a strict environment allowlist without secret values', () => {
    const env = buildReleaseWorkerEnvironment({
      PATH: '/bin',
      HOME: '/safe-home',
      ENV_REGION: 'cn',
      DEPLOY_TOKEN: 'must-not-leak',
      DB_PASSWORD: 'must-not-leak',
      OPENAI_API_KEY: 'must-not-leak',
    }, {
      KERNEL_RELEASE_RUN_ID: 'run',
      KERNEL_RELEASE_PRIVATE_CONFIG_FILE: '/tmp/private-ref',
    });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/safe-home',
      ENV_REGION: 'cn',
      KERNEL_RELEASE_RUN_ID: 'run',
      KERNEL_RELEASE_PRIVATE_CONFIG_FILE: '/tmp/private-ref',
    });
    expect(JSON.stringify(env)).not.toContain('must-not-leak');
  });

  it('passes authorization and database secrets only through a 0600 file reference', () => {
    const value = {
      authorization: '55555555-5555-4555-8555-555555555555',
      deploy_token: 'deploy-secret',
      database: {
        host: 'localhost',
        port: 5432,
        database: 'cecelia_test',
        user: 'cecelia',
        password: 'db-secret',
      },
    };
    const reference = createPrivateReleaseWorkerConfig(value);
    try {
      expect(statSync(reference.file).mode & 0o777).toBe(0o600);
      expect(readPrivateReleaseWorkerConfig(reference.file)).toEqual(value);
      expect(readFileSync(reference.file, 'utf8')).toContain('db-secret');
    } finally {
      cleanupPrivateReleaseWorkerConfig(reference.file);
    }
    expect(() => statSync(reference.file)).toThrow();
  });

  it('lets the release guard consume only the hardened private file reference', () => {
    const reference = createPrivateReleaseWorkerConfig({
      authorization: '55555555-5555-4555-8555-555555555555',
      deploy_token: 'deploy-secret',
      database: {},
    });
    try {
      const guard = resolve(
        import.meta.dirname,
        '../../../../../scripts/lib/release-run-guard.sh',
      );
      const result = spawnSync('bash', ['-c', `
        curl() {
          local out="" previous=""
          for arg in "$@"; do
            if [[ "$previous" == "--output" ]]; then out="$arg"; fi
            previous="$arg"
          done
          printf '{"authorized":true}' > "$out"
          printf 200
        }
        export -f curl
        source "$1"
        require_release_run_authority production
      `, '--', guard], {
        env: {
          PATH: process.env.PATH,
          KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
          KERNEL_RELEASE_MERGE_SHA: 'f'.repeat(40),
          KERNEL_RELEASE_PRIVATE_CONFIG_FILE: reference.file,
        },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      cleanupPrivateReleaseWorkerConfig(reference.file);
    }
  });

  it('rejects hard links and private files under an unsafe parent directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-worker-secret-test-'));
    try {
      const external = join(root, 'external.json');
      writeFileSync(external, JSON.stringify({
        authorization: 'a',
        deploy_token: 'b',
        database: {},
      }), { mode: 0o600 });
      const unsafeParent = join(root, 'cecelia-release-worker-attacker');
      mkdirSync(unsafeParent, { mode: 0o700 });
      const authority = join(unsafeParent, 'authority.json');
      linkSync(external, authority);
      expect(() => readPrivateReleaseWorkerConfig(authority))
        .toThrow('release_worker_private_reference_invalid');

      rmSync(authority);
      writeFileSync(authority, readFileSync(external), { mode: 0o600 });
      chmodSync(unsafeParent, 0o777);
      expect(() => readPrivateReleaseWorkerConfig(authority))
        .toThrow('release_worker_private_reference_invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes only stale owner-only release worker secret directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-worker-reaper-test-'));
    try {
      const stale = createPrivateReleaseWorkerConfig({
        authorization: 'a',
        deploy_token: 'b',
        database: {},
      }, { temporaryRoot: root, now: () => new Date(0) });
      const fresh = createPrivateReleaseWorkerConfig({
        authorization: 'c',
        deploy_token: 'd',
        database: {},
      }, { temporaryRoot: root, now: () => new Date(10_000) });

      const result = cleanupStalePrivateReleaseWorkerConfigs({
        temporaryRoot: root,
        now: () => new Date(20_000),
        staleAfterMs: 15_000,
      });

      expect(result.removed).toBe(1);
      expect(() => statSync(stale.file)).toThrow();
      expect(statSync(fresh.file).isFile()).toBe(true);
      cleanupPrivateReleaseWorkerConfig(fresh.file);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
