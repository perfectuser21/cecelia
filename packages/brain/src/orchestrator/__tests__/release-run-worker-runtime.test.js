import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildReleaseWorkerEnvironment,
  runLeasedReleaseRoutes,
} from '../../../../../scripts/lib/release-run-worker-runtime.mjs';
import {
  acquireProductionMutationLock,
} from '../../../../../scripts/lib/release-run-production-lock.mjs';
import {
  isProductionRouteComplete,
} from '../../../../../scripts/lib/release-run-production-progress.mjs';
import {
  cleanupPrivateReleaseWorkerConfig,
  createPrivateRollbackWorkerConfig,
  createPrivateReleaseWorkerConfig,
  cleanupStalePrivateReleaseWorkerConfigs,
  readPrivateReleaseWorkerConfig,
  readPrivateRollbackWorkerConfig,
} from '../release-run-worker-secret.js';

describe('leased ReleaseRun worker runtime', () => {
  it('recognizes Brain completion from the route-owned deploy receipt and live runtime identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-progress-brain-'));
    try {
      const repoRoot = join(root, 'repo');
      const releaseRunId = '11111111-1111-4111-8111-111111111111';
      const mergeSha = 'b'.repeat(40);
      const deployedImageDigest = `sha256:${'a'.repeat(64)}`;
      const artifact = {
        name: 'brain',
        version: '1.2.3',
        digest: `sha256:${'9'.repeat(64)}`,
      };
      mkdirSync(join(repoRoot, 'logs'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'logs/cecelia-deploy-status.json'),
        JSON.stringify({
          status: 'success',
          release_run_id: releaseRunId,
          merge_sha: mergeSha,
          deployed_artifact_versions: [artifact],
          deployed_image_digest: deployedImageDigest,
        }),
      );

      await expect(isProductionRouteComplete({
        route: { artifact: 'brain' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha,
        inspectBrainDeployment: async () => ({
          imageDigest: deployedImageDigest,
          gitSha: mergeSha,
          running: true,
        }),
      })).resolves.toBe(true);

      await expect(isProductionRouteComplete({
        route: { artifact: 'brain' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha,
        inspectBrainDeployment: async () => ({
          imageDigest: artifact.digest,
          gitSha: mergeSha,
          running: true,
        }),
      })).resolves.toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recognizes Dashboard completion from source identity plus deployed receipt digest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-progress-dashboard-'));
    try {
      const repoRoot = join(root, 'repo');
      const releaseRunId = '22222222-2222-4222-8222-222222222222';
      const mergeSha = 'c'.repeat(40);
      const artifact = {
        name: 'workspace',
        version: mergeSha.slice(0, 12),
        digest: `sha256:${'8'.repeat(64)}`,
      };
      const distRoot = join(repoRoot, 'apps/dashboard/dist');
      const receiptRoot = join(repoRoot, 'logs/release-rollbacks/dashboard');
      mkdirSync(distRoot, { recursive: true });
      mkdirSync(receiptRoot, { recursive: true });
      writeFileSync(join(distRoot, 'index.html'), '<h1>deployed</h1>\n');
      const deployedDigest = `sha256:${createHash('sha256')
        .update('placeholder').digest('hex')}`;
      const { digestTree } = await import(
        '../../../../../scripts/lib/release-run-tree-digest.mjs'
      );
      const actualDeployedDigest = digestTree(distRoot);
      expect(actualDeployedDigest).not.toBe(artifact.digest);
      expect(actualDeployedDigest).not.toBe(deployedDigest);
      writeFileSync(join(repoRoot, '.production-release'), [
        'current=prod-cecelia-v9',
        `commit=${mergeSha}`,
        '',
      ].join('\n'));
      writeFileSync(
        join(receiptRoot, `${releaseRunId}.json`),
        JSON.stringify({
          schema_version: 1,
          release_run_id: releaseRunId,
          merge_sha: mergeSha,
          artifact_name: 'workspace',
          current_version: artifact.version,
          current_digest: artifact.digest,
          current_deployed_digest: actualDeployedDigest,
          new_tag: 'prod-cecelia-v9',
          anchor: `workspace:${artifact.digest}`,
        }),
      );

      await expect(isProductionRouteComplete({
        route: { artifact: 'workspace' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha,
      })).resolves.toBe(true);

      writeFileSync(join(distRoot, 'index.html'), '<h1>tampered</h1>\n');
      await expect(isProductionRouteComplete({
        route: { artifact: 'workspace' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha,
      })).resolves.toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recognizes persistent Workflow completion after the execution workspace is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-progress-workflow-'));
    try {
      const repoRoot = join(root, 'repo');
      const accountRoot = join(root, 'account');
      const releaseRunId = '44444444-4444-4444-8444-444444444444';
      const persistentSkill = join(
        accountRoot,
        '.kernel-releases/workflow-skills',
        releaseRunId,
        'example',
      );
      const liveSkill = join(accountRoot, 'skills/example');
      const rollbackRoot = join(
        repoRoot,
        'logs/release-rollbacks/workflow-skills',
      );
      const workflowSourceRoot = join(root, 'snapshot/packages/workflows/skills');
      mkdirSync(persistentSkill, { recursive: true });
      mkdirSync(join(workflowSourceRoot, 'example'), { recursive: true });
      mkdirSync(join(accountRoot, 'skills'), { recursive: true });
      mkdirSync(rollbackRoot, { recursive: true });
      writeFileSync(join(persistentSkill, 'SKILL.md'), '# persistent\n');
      writeFileSync(
        join(workflowSourceRoot, 'example/SKILL.md'),
        '# persistent\n',
      );
      symlinkSync(persistentSkill, liveSkill);
      writeFileSync(
        join(rollbackRoot, `${releaseRunId}.links`),
        `${liveSkill}\tabsent\n`,
      );
      const current = `${liveSkill}\t${persistentSkill}\n`;
      const currentDigest = `sha256:${createHash('sha256')
        .update(current).digest('hex')}`;
      const artifact = {
        name: 'workflow-skills',
        digest: `sha256:${'9'.repeat(64)}`,
      };
      writeFileSync(
        join(rollbackRoot, `${releaseRunId}.json`),
        JSON.stringify({
          anchor: `workflow-skills:${artifact.digest}`,
          current_links_digest: currentDigest,
        }),
      );
      await expect(isProductionRouteComplete({
        route: { artifact: 'workflow-skills' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha: 'b'.repeat(40),
        skillsDeployRoots: accountRoot,
        workflowSourceRoot,
      })).resolves.toBe(true);
      rmSync(persistentSkill, { recursive: true, force: true });
      await expect(isProductionRouteComplete({
        route: { artifact: 'workflow-skills' },
        artifact,
        repoRoot,
        releaseRunId,
        mergeSha: 'b'.repeat(40),
        skillsDeployRoots: accountRoot,
        workflowSourceRoot,
      })).resolves.toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('holds one cross-worker production mutation lock until explicit release', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] }),
      release: vi.fn(),
    };
    const lock = await acquireProductionMutationLock({
      connect: vi.fn(async () => client),
    });
    expect(client.query.mock.calls[0][0]).toMatch(/pg_try_advisory_lock/);
    expect(client.query.mock.calls[0][0])
      .toMatch(/kernel-release\/production-mutation\/v1/);
    expect(client.release).not.toHaveBeenCalled();
    await lock.release();
    expect(client.query.mock.calls[1][0]).toMatch(/pg_advisory_unlock/);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when another forward or rollback worker owns the mutation lock', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ acquired: false }] })),
      release: vi.fn(),
    };
    await expect(acquireProductionMutationLock({
      connect: vi.fn(async () => client),
    }, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'release_production_mutation_busy',
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

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

    expect(appendOutcome).toHaveBeenCalledWith(21, 3, 'unknown', {
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
      KERNEL_RELEASE_ROLLBACK_AUTHORIZATION: 'must-not-leak',
    }, {
      KERNEL_RELEASE_RUN_ID: 'run',
      KERNEL_RELEASE_PRIVATE_CONFIG_FILE: '/tmp/private-ref',
      KERNEL_RELEASE_ROLLBACK_AUTHORIZATION: 'must-not-leak',
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

  it('uses a rollback-only private schema with no forward deploy authority', () => {
    const value = {
      rollback_authorization: '55555555-5555-4555-8555-555555555555',
      database: { host: 'localhost', user: 'rollback-worker' },
    };
    const reference = createPrivateRollbackWorkerConfig(value);
    try {
      expect(readPrivateRollbackWorkerConfig(reference.file)).toEqual(value);
      const serialized = readFileSync(reference.file, 'utf8');
      expect(serialized).not.toContain('deploy_token');
      expect(serialized).not.toContain('"authorization"');
    } finally {
      cleanupPrivateReleaseWorkerConfig(reference.file);
    }
    expect(() => createPrivateRollbackWorkerConfig({
      ...value,
      deploy_token: 'forbidden',
    })).toThrow('release_rollback_worker_private_config_invalid');
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
