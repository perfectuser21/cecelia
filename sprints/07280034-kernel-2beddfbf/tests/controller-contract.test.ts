import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';
import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { Pool } = pg;
const BOOTSTRAP_ENV = 'HARNESS_OPERATOR_BOOTSTRAP_URL';
const schema = `contract_${process.pid}_${Date.now()}`;
const createdIds = [];
let admin;
let pool;
let attemptStore;

function operatorUrl() {
  const value = process.env[BOOTSTRAP_ENV];
  if (!value) {
    throw new Error(
      `FAKE_RED: ${BOOTSTRAP_ENV} 缺失；禁止回退到 TEST_DATABASE_URL、DB_NAME 或仓库默认值`,
    );
  }
  return value;
}

function makeContract() {
  return Object.freeze({
    id: randomUUID(),
    contract_sha: 'a'.repeat(40),
    frozen: true,
    role_commands: Object.freeze({
      generator: Object.freeze({ command: 'generate', database_backed: true }),
      evaluator: Object.freeze({ command: 'evaluate', database_backed: true }),
      judge: Object.freeze({ command: 'judge', database_backed: false }),
      reporter: Object.freeze({ command: 'report', database_backed: false }),
    }),
  });
}

function observed(taskId, contract, payload = {}) {
  return {
    task: {
      id: taskId,
      title: 'controller contract red',
      description: 'exercise the current production dispatcher',
      payload: {
        sprint_dir: 'sprints/07280034-kernel-2beddfbf',
        worktree_path: '/workspace',
        executor: 'claude',
        ...payload,
      },
    },
    run: { id: randomUUID() },
    contract: { approved: true, row: contract },
    pr: null,
    prdExists: true,
    proposeBranchRn: 1,
    proposeBranch: 'cp-contract',
    proposeBranchSha: contract.contract_sha,
  };
}

function externalSeams(launches) {
  // 该 adapter 只替代未改的外部 provider 进程，不能作为 local/fleet 真链证据。
  const provider = {
    name: 'claude',
    start: () => ({
      provider: 'claude',
      command: 'claude',
      args: ['--output-format', 'json'],
      stdin: 'bounded contract test',
      output: { format: 'json' },
      env: {},
    }),
  };
  return {
    registry: { resolve: () => provider },
    launcher: {
      async launch(input) {
        launches.push(input);
        return {
          actualMachineId: input.target.machine,
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
          containerId: `contract-${input.attempt.id.slice(0, 8)}`,
          jobId: null,
        };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    },
    loadSkill: (name) => ({
      name,
      version: '9.16.0',
      digest: `sha256:${'b'.repeat(64)}`,
      content: 'contract test skill',
    }),
  };
}

async function dispatchDatabaseBacked({
  role = 'generator',
  contract = makeContract(),
  payload = {},
  machineId = 'us-mac-m4',
} = {}) {
  const launches = [];
  const taskId = randomUUID();
  const state = observed(taskId, contract, payload);
  const runId = state.run.id;
  createdIds.push({ runId, taskId });
  await pool.query(
    'INSERT INTO initiative_runs (id, task_id, contract_facts) VALUES ($1,$2,$3)',
    [runId, taskId, contract],
  );
  const dispatcher = createDispatcher({
    attemptStore,
    ...externalSeams(launches),
    machineId,
    leaseOwner: `contract-red:${process.pid}`,
  });
  const action = `spawn:${role}`;
  const result = await dispatcher(action, {
    taskId,
    runId,
    hop: 1,
    observed: state,
    decision: { phase: 'implement', reason: 'contract-red' },
  });
  return { result, launches, runId, taskId };
}

beforeAll(async () => {
  admin = new Pool({
    connectionString: operatorUrl(),
    connectionTimeoutMillis: 3_000,
    max: 2,
  });
  const identity = await admin.query(
    'SELECT current_database() AS database_name, current_user AS role_name, inet_server_addr()::text AS server_addr',
  );
  expect(identity.rows[0].database_name).toBe('harness_controller_bootstrap');
  expect(identity.rows[0].role_name).toBe('postgres');
  expect(identity.rows[0].server_addr).toBe('192.168.215.2/32');

  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`
    CREATE TABLE "${schema}".initiative_runs (
      id uuid PRIMARY KEY,
      task_id uuid NOT NULL,
      contract_facts jsonb NOT NULL
    );
    CREATE TABLE "${schema}".harness_attempts (
      id uuid PRIMARY KEY,
      run_id uuid NOT NULL REFERENCES "${schema}".initiative_runs(id) ON DELETE CASCADE,
      hop integer NOT NULL,
      phase text NOT NULL,
      role text NOT NULL,
      provider text NOT NULL,
      account_id text,
      machine_id text,
      requested_machine_id text,
      local_container_naming text,
      skill_name text,
      skill_version text,
      skill_digest text,
      task_bundle jsonb NOT NULL,
      result jsonb,
      status text NOT NULL DEFAULT 'queued',
      provider_session_id text,
      callback_secret_hash text NOT NULL,
      lease_owner text,
      lease_expires_at timestamptz,
      heartbeat_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      error_code text,
      error_message text,
      logical_cycle_id text,
      attempt_kind text NOT NULL DEFAULT 'initial',
      retry_of_attempt_id uuid,
      restart_reason text,
      workstream_key text NOT NULL DEFAULT 'ws1',
      time_derived boolean NOT NULL DEFAULT false,
      actual_machine_id text,
      execution_transport text,
      remote_job_id text,
      machine_attestation_status text,
      lease_generation integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (run_id, hop)
    )
  `);
  pool = new Pool({
    connectionString: operatorUrl(),
    options: `-c search_path=${schema}`,
    connectionTimeoutMillis: 3_000,
    max: 4,
  });
  attemptStore = createAttemptStore(pool);
});

afterAll(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

describe('server-owned Test Environment Controller（真实 PG + 当前生产 dispatcher）', () => {
  it('合格 DB-backed generator 在 attempt 持久化后获得 server-owned 瞬态 capability', async () => {
    const { launches, runId } = await dispatchDatabaseBacked();
    const persisted = await pool.query(
      'SELECT id, task_bundle FROM harness_attempts WHERE run_id=$1',
      [runId],
    );
    expect(persisted.rowCount).toBe(1);
    expect(launches).toHaveLength(1);
    const capability = launches[0].testEnvironmentCapability;
    expect(capability, 'BUSINESS_RED: dispatcher 未签发 server-owned capability').toBeTruthy();
    expect(capability.attemptId).toBe(persisted.rows[0].id);
    expect(capability.databaseUrl).toMatch(/^postgresql:\/\//);
    expect(capability.receipt).not.toHaveProperty('database_url');
  });

  it('调用方 payload 的 URL、receipt、database、role、nonce、CIDR 全部无权且不持久化', async () => {
    const attacker = {
      test_database_url: 'postgresql://attacker@production.invalid/cecelia',
      TEST_DATABASE_URL: 'postgresql://attacker@production.invalid/cecelia',
      harness_db_receipt: { nonce: 'caller-nonce', database_name: 'cecelia' },
      database_name: 'cecelia',
      role_name: 'postgres',
      nonce: 'caller-nonce',
      allowed_cidrs: ['0.0.0.0/0'],
      contract_requirements: { postgres: true },
    };
    const { launches, result } = await dispatchDatabaseBacked({ payload: attacker });
    const row = await pool.query(
      'SELECT task_bundle::text AS bundle, result::text AS result FROM harness_attempts WHERE id=$1',
      [result.attemptId],
    );
    expect(row.rowCount, 'BUSINESS_RED: attempt 必须先持久化').toBe(1);
    const persisted = JSON.stringify(row.rows[0]);
    expect(persisted).not.toContain('attacker');
    expect(persisted).not.toContain('caller-nonce');
    expect(persisted).not.toContain('production.invalid');
    expect(launches[0].testEnvironmentCapability.databaseUrl).not.toContain('attacker');
  });

  it('两个独立 attempt 不共享 database、role 或 nonce', async () => {
    const local = await dispatchDatabaseBacked({ machineId: 'us-mac-m4' });
    const fleet = await dispatchDatabaseBacked({ machineId: 'us-mac-m4' });
    const left = local.launches[0].testEnvironmentCapability;
    const right = fleet.launches[0].testEnvironmentCapability;
    expect(left, 'BUSINESS_RED: 第一个 attempt 未获独立 capability').toBeTruthy();
    expect(right, 'BUSINESS_RED: 第二个 attempt 未获独立 capability').toBeTruthy();
    expect(left.databaseName).not.toBe(right.databaseName);
    expect(left.roleName).not.toBe(right.roleName);
    expect(left.receipt.nonce).not.toBe(right.receipt.nonce);
  });

  it('judge 与无关 reporter 不获得 URL 或 receipt', async () => {
    const contract = makeContract();
    const judgeTaskId = randomUUID();
    const judgeObserved = observed(judgeTaskId, contract);
    const judgeRunId = judgeObserved.run.id;
    await pool.query(
      'INSERT INTO initiative_runs (id, task_id, contract_facts) VALUES ($1,$2,$3)',
      [judgeRunId, judgeTaskId, contract],
    );
    let judgeInput;
    const dispatcher = createDispatcher({
      attemptStore,
      ...externalSeams([]),
      machineId: 'us-mac-m4',
      handlers: {
        'spawn:judge': async (input) => {
          judgeInput = input;
          return { status: 'completed', artifacts: [], checks: [], decision: null, error: null };
        },
      },
    });
    await dispatcher('spawn:judge', {
      taskId: judgeTaskId,
      runId: judgeRunId,
      hop: 1,
      observed: judgeObserved,
      decision: { phase: 'verify', reason: 'judge absence' },
    });
    expect(judgeInput).not.toHaveProperty('testEnvironmentCapability');
    expect(JSON.stringify(judgeInput)).not.toContain('TEST_DATABASE_URL');
    expect(JSON.stringify(judgeInput)).not.toContain('HARNESS_DB_RECEIPT');
  });
});
