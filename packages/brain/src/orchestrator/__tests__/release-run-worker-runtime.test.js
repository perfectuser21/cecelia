import { describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';

import {
  buildReleaseWorkerEnvironment,
  runLeasedReleaseRoutes,
} from '../../../../../scripts/lib/release-run-worker-runtime.mjs';
import {
  cleanupPrivateReleaseWorkerConfig,
  createPrivateReleaseWorkerConfig,
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
    expect(order.at(-1)).toBe('outcome:dispatched');
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
});
