import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDispatcher, createDetachedLauncher } from '../../../packages/brain/src/orchestrator/dispatcher.js';
import { createProviderRegistry } from '../../../packages/brain/src/orchestrator/provider-registry.js';
import { createRemoteBridgeTransport } from '../../../packages/brain/src/orchestrator/remote-bridge-transport.js';

const BOOTSTRAP_DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap';
const BOOTSTRAP_SERVER_CIDR = '192.168.215.2/32';
const SHARED_SECRET = 'kernel-test-env-controller-bridge-token-123456';
const TASK_ID = '769cdf5b-1893-40a2-abf8-1e3ee11d8470';
const RUN_ID = '68bd49de-0109-4da0-96c1-74f3b640f518';
const ATTEMPT_ID = 'f1935111-d212-4c0f-95b5-8b467d3d5607';
const LEASE_OWNER = 'kernel-test-env-controller:4242';

let adminPool: pg.Pool;
const cleanupSql: string[] = [];

function makeObserved(payload: Record<string, unknown> = {}) {
  return {
    task: {
      id: TASK_ID,
      title: 'P0 Kernel Test Environment Controller Recovery 2 real PG+runner Red 07272309',
      description: 'red contract test',
      payload: {
        sprint_dir: 'sprints/07280011-kernel-769cdf5b',
        worktree_path: '/workspace',
        role_assignments: {
          proposer: { provider: 'codex', account: 'team1' },
        },
        ...payload,
      },
    },
    run: { id: RUN_ID, phase: 'gan' },
    contract: { row: {} },
    pr: null,
  };
}

function providerAdapter() {
  return {
    name: 'codex',
    capabilities: ['structured_output'],
    start() {
      return {
        provider: 'codex',
        command: 'codex',
        args: ['exec', '--model', 'gpt-5-codex'],
        env: { CODEX_HOME: '/tmp/codex-team1' },
        stdin: '{"instruction":"kernel-test-env-controller"}',
        output: 'json',
      };
    },
    resume() {},
    inspect() {},
    cancel() {},
    normalizeResult() {},
  };
}

function parseDockerCreateEnv(args: string[]) {
  const env = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--env') continue;
    const pair = String(args[index + 1] ?? '');
    const separator = pair.indexOf('=');
    env.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return env;
}

async function createIsolatedAttemptDatabase() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const databaseName = `harness_attempt_${suffix}`;
  const roleName = `harness_role_${suffix}`;
  const prodLikeName = `cecelia_prodlike_${suffix}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await adminPool.query(`CREATE ROLE ${roleName} LOGIN`);
  cleanupSql.unshift(`DROP ROLE IF EXISTS ${roleName}`);

  await adminPool.query(`CREATE DATABASE ${databaseName} OWNER ${roleName}`);
  cleanupSql.unshift(`DROP DATABASE IF EXISTS ${databaseName}`);

  await adminPool.query(`CREATE DATABASE ${prodLikeName}`);
  cleanupSql.unshift(`DROP DATABASE IF EXISTS ${prodLikeName}`);

  const testDatabaseUrl = `postgresql://${roleName}@host.docker.internal:55439/${databaseName}`;
  return {
    databaseName,
    roleName,
    prodLikeName,
    testDatabaseUrl,
    receipt: {
      version: 1,
      issuer: 'kernel-test-environment-controller',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      task_id: TASK_ID,
      role: 'proposer',
      contract_sha: 'd37a5e57827900be2651fe39655690238513128f',
      execution_surface: 'local-docker',
      database_name: databaseName,
      role_name: roleName,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      nonce: `nonce-${suffix}`,
      allowed_cidrs: [BOOTSTRAP_SERVER_CIDR],
      schema_digest: 'sha256:kernel-test-env-controller-schema',
      cleanup_outcome: 'pending',
      cleanup_at: null,
    },
  };
}

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: BOOTSTRAP_DATABASE_URL, max: 2 });
  await adminPool.query('SELECT 1');
});

afterEach(async () => {
  while (cleanupSql.length > 0) {
    const sql = cleanupSql.shift();
    if (!sql) continue;
    await adminPool.query(sql).catch(() => {});
  }
});

afterAll(async () => {
  await adminPool.end();
});

describe('Kernel test environment controller real red', () => {
  it('dispatcher local path injects TEST_DATABASE_URL and credential-free receipt only for DB-backed proposer bundle', async () => {
    const isolated = await createIsolatedAttemptDatabase();
    let launchedEnv: Record<string, string> | null = null;

    const launcher = createDetachedLauncher({
      attemptStore: {
        markStarting: async () => ({
          id: ATTEMPT_ID,
          status: 'starting',
          lease_owner: LEASE_OWNER,
          lease_generation: 0,
        }),
        fail: async () => ({ ok: true }),
      } as any,
      brainUrl: 'http://127.0.0.1:5221',
      leaseOwner: LEASE_OWNER,
      machineId: 'us-mac-m4',
      removeContainer: async () => true,
      spawnDetached: async ({ env, containerId }: any) => {
        launchedEnv = env;
        return { containerId };
      },
    });

    const dispatcher = createDispatcher({
      attemptStore: {
        createAttempt: async (input: any) => ({
          ...input,
          id: ATTEMPT_ID,
          run_id: input.runId,
          task_bundle: input.bundle,
          local_container_naming: 'generation-v1',
        }),
        markStarting: async () => ({
          id: ATTEMPT_ID,
          status: 'starting',
          lease_owner: LEASE_OWNER,
          lease_generation: 0,
        }),
        recordLaunchReceipt: async (_id: string, receipt: any) => ({ status: 'starting', ...receipt }),
        fail: async () => ({ ok: true }),
      } as any,
      registry: createProviderRegistry([providerAdapter() as any]),
      launcher,
      loadSkill: () => ({
        name: 'harness-contract-proposer',
        version: '9.16.0',
        digest: `sha256:${'a'.repeat(64)}`,
        content: 'skill',
      }),
      handlers: {},
      preflightGate: {
        evaluate: async () => ({
          status: 'ok',
          snapshot: {
            provider: 'codex',
            account: 'team1',
            machine: 'us-mac-m4',
            capability_snapshot_id: 'snapshot-local-db-capability',
          },
          evidence: {},
          to_target: {
            provider: 'codex',
            account: 'team1',
            machine: 'us-mac-m4',
          },
        }),
        validateSnapshotForDispatch: async () => ({ status: 'ok' }),
      },
      machineId: 'us-mac-m4',
      resolveAccountHome: () => '/tmp/codex-team1',
    });

    await dispatcher('spawn:proposer', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 2,
      observed: makeObserved({
        contract_requirements: { postgres: true },
        test_database_url: isolated.testDatabaseUrl,
        test_database_receipt: isolated.receipt,
      }),
      decision: { phase: 'gan', reason: 'contract_approved' },
    });

    expect(launchedEnv?.TEST_DATABASE_URL).toBe(isolated.testDatabaseUrl);
    expect(launchedEnv?.HARNESS_DB_RECEIPT).toBeDefined();
    const parsed = JSON.parse(String(launchedEnv?.HARNESS_DB_RECEIPT ?? '{}'));
    expect(parsed).toMatchObject({
      database_name: isolated.databaseName,
      role_name: isolated.roleName,
      allowed_cidrs: [BOOTSTRAP_SERVER_CIDR],
    });
    expect(JSON.stringify(parsed)).not.toContain(isolated.testDatabaseUrl);
  });

  it('remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL and receipt into docker create env', async () => {
    const isolated = await createIsolatedAttemptDatabase();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-test-env-remote-'));
    const stateRoot = path.join(tempRoot, 'state');
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-test-env-workspace-'));
    const adminRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-test-env-admin-'));
    let dockerCreateArgs: string[] | null = null;

    const { createAttemptRunner, createDockerAdapter, createFileAttemptStateStore } = await import('../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs');
    const { createFleetWorkerServer } = await import('../../../packages/brain/scripts/fleet-worker/fleet-worker.cjs');

    const docker = createDockerAdapter({
      runtimeRoot,
      runCommand: async (_command: string, args: string[]) => {
        if (args[0] === 'create') {
          dockerCreateArgs = args;
          return { stdout: 'remote-container-1' };
        }
        if (args[0] === 'start') return { stdout: '' };
        if (args[0] === 'wait') return new Promise(() => {});
        if (args[0] === 'rm') return { stdout: '' };
        if (args[0] === 'ps') return { stdout: '' };
        if (args[0] === 'inspect') return { stdout: 'running' };
        throw new Error(`unexpected docker command: ${args.join(' ')}`);
      },
    });
    const stateStore = createFileAttemptStateStore({ stateRoot });
    const attemptRunner = createAttemptRunner({
      workerId: 'xian-mac-m4',
      runnerImageDigest: `cecelia/runner@sha256:${'b'.repeat(64)}`,
      docker,
      stateStore,
      workspaceManager: {
        prepare: async () => ({
          path: workspaceRoot,
          admin_path: adminRoot,
          mode: 'read-write',
          head_sha: 'd37a5e57827900be2651fe39655690238513128f',
        }),
        verify: async () => ({ ok: true }),
        cleanup: async () => ({ status: 'cleaned' }),
        quarantine: async () => ({ status: 'quarantined', reason: 'not-used' }),
        reconcile: async () => ({ retained: [], quarantined: [], cleaned: [] }),
      },
    });

    const server = createFleetWorkerServer({
      attemptRunner,
      attemptToken: SHARED_SECRET,
      probeHealth: async () => ({
        schema_version: 'fleet-node-health/v1',
        machine_id: 'xian-mac-m4',
        observed_at: new Date().toISOString(),
        worker: { protocol_version: '1', contract_version: '1', version: '1' },
        runner: { version: '1', image_digest: `sha256:${'c'.repeat(64)}` },
        os: { version: '14.0' },
        orbstack: { version: '1.0' },
        docker: { available: true, observed_at: new Date().toISOString() },
        resources: {
          cpu_cores: 8,
          memory_bytes: 8 * 1024 * 1024 * 1024,
          disk_free_bytes: 20 * 1024 * 1024 * 1024,
          disk_used_percent: 10,
          cpu_pressure_percent: 0,
          memory_pressure_percent: 0,
        },
        git: { available: true, version: '2.47.0' },
        node: { available: true, version: process.version },
        codex: { available: true, version: '1' },
        tailscale: { connected: true },
        callback: { reachable: true },
        time_sync: { synchronized: true },
        power: { sleep_disabled: true, auto_power_on: true },
        launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
        worktree: { root_ready: true },
        container: { probe_succeeded: true },
        drain: { active: false },
      }),
    });

    const listening = await new Promise<{ port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve({ port: typeof address === 'object' && address ? address.port : 0 });
      });
    });

    try {
      const transport = createRemoteBridgeTransport({
        enabled: true,
        bridgeUrls: { 'xian-mac-m4': `http://127.0.0.1:${listening.port}` },
        sharedSecret: SHARED_SECRET,
        brainUrl: 'http://127.0.0.1:5221',
        fetchFn: globalThis.fetch,
      });

      await transport.launch({
        attempt: {
          id: ATTEMPT_ID,
          run_id: RUN_ID,
          lease_owner: LEASE_OWNER,
          lease_generation: 0,
          callbackSecret: 'callback-secret-1234567890',
        },
        bundle: {
          role: 'proposer',
          inputs: {
            execution_surface: 'fleet-worker',
            workspace_spec: {
              repo: 'perfectuser21/cecelia',
              branch: 'cp-harness-propose-r1-769cdf5b-a2',
              run_id: RUN_ID,
              attempt_id: ATTEMPT_ID,
            },
            test_database_url: isolated.testDatabaseUrl,
            test_database_receipt: isolated.receipt,
          },
        },
        spec: {
          provider: 'codex',
          command: 'codex',
          args: ['exec'],
          stdin: '{"instruction":"remote-db-capability"}',
          output: 'json',
        },
        target: {
          provider: 'codex',
          account: 'team1',
          machine: 'xian-mac-m4',
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      fs.rmSync(adminRoot, { recursive: true, force: true });
    }

    const env = parseDockerCreateEnv(dockerCreateArgs ?? []);
    expect(env.get('TEST_DATABASE_URL')).toBe(isolated.testDatabaseUrl);
    expect(env.get('HARNESS_DB_RECEIPT')).toBeDefined();
    const parsed = JSON.parse(String(env.get('HARNESS_DB_RECEIPT') ?? '{}'));
    expect(parsed).toMatchObject({
      database_name: isolated.databaseName,
      role_name: isolated.roleName,
      allowed_cidrs: [BOOTSTRAP_SERVER_CIDR],
    });
    expect(JSON.stringify(parsed)).not.toContain(isolated.testDatabaseUrl);
  });

  it('pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases', async () => {
    const isolated = await createIsolatedAttemptDatabase();
    const roleClient = new pg.Client({ connectionString: isolated.testDatabaseUrl });
    await roleClient.connect();
    try {
      const probe = await roleClient.query(
        `
          SELECT
            current_database() AS current_database,
            current_user AS current_user,
            inet_server_addr()::text AS inet_server_addr,
            has_database_privilege(current_user, $1, 'CONNECT') AS prod_connect
        `,
        [isolated.prodLikeName],
      );

      expect(probe.rows[0]).toMatchObject({
        current_database: isolated.databaseName,
        current_user: isolated.roleName,
        inet_server_addr: BOOTSTRAP_SERVER_CIDR,
        prod_connect: false,
      });
    } finally {
      await roleClient.end();
    }
  });
});
