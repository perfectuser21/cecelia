import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';
import { recoverDurableRun } from '../../../packages/brain/src/orchestrator/durable-resume.js';
import { createProviderRegistry } from '../../../packages/brain/src/orchestrator/provider-registry.js';
import { codexAdapter } from '../../../packages/brain/src/orchestrator/providers/codex.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

const TASK_ID = 'f09c9e31-ed78-4af4-a1b6-88241bc486c5';
const INITIATIVE_ID = TASK_ID;
const JOURNEY_ID = '741d4acc-9ca8-4545-a971-efa12fce8150';
const DECOY_TASK_ID = 'f09c9e31-ed78-4af4-a1b6-88241bc486c6';
const DECOY_APPROVED_ID = '10000000-0000-4000-8000-000000000099';
const APPROVED_V1 = '10000000-0000-4000-8000-000000000001';
const APPROVED_V2 = '10000000-0000-4000-8000-000000000002';
const OLD_RUN_ID = '20000000-0000-4000-8000-000000000001';
const CURRENT_RUN_ID = '20000000-0000-4000-8000-000000000002';
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/102';

let client;

function taskRow(payload = {}) {
  return {
    id: TASK_ID,
    title: 'P1 Kernel durable resume：跨 run 去重与恢复',
    task_type: 'harness_initiative',
    status: 'queued',
    ability_id: null,
    payload: {
      harness_runtime: 'kernel-v1',
      sprint_dir: 'sprints/07251915-kernel-f09c9e31',
      review_required: false,
      journey_id: JOURNEY_ID,
      ...payload,
    },
  };
}

async function createKernelTempSchema() {
  await client.query(`
    CREATE TEMP SEQUENCE kernel_run_seq;
    CREATE TEMP TABLE tasks (
      id uuid PRIMARY KEY,
      title text,
      description text,
      task_type text,
      status text,
      payload jsonb DEFAULT '{}'::jsonb,
      ability_id uuid,
      claimed_by text,
      claimed_at timestamptz,
      updated_at timestamptz DEFAULT now()
    );

    CREATE TEMP TABLE initiative_contracts (
      id uuid PRIMARY KEY,
      initiative_id uuid NOT NULL,
      version integer NOT NULL,
      status text NOT NULL,
      prd_content text,
      contract_content text,
      review_rounds integer DEFAULT 0,
      approved_at timestamptz,
      branch text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TEMP TABLE initiative_runs (
      id uuid PRIMARY KEY DEFAULT (
        '20000000-0000-4000-8000-' || lpad(nextval('kernel_run_seq')::text, 12, '0')
      )::uuid,
      initiative_id uuid NOT NULL,
      contract_id uuid,
      phase text NOT NULL DEFAULT 'planning',
      current_task_id uuid,
      merged_task_ids uuid[] DEFAULT ARRAY[]::uuid[],
      cost_usd numeric DEFAULT 0,
      pr_url text,
      evaluate_verdict text,
      judge_verdict text,
      orchestrator_version text DEFAULT 'v2',
      orchestrator_host text,
      orchestrator_pid integer,
      orchestrator_heartbeat_at timestamptz,
      deadline_at timestamptz,
      completed_at timestamptz,
      failure_reason text,
      journey_id uuid,
      ability_id uuid,
      started_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TEMP TABLE orchestrator_decision_log (
      id bigserial PRIMARY KEY,
      run_id uuid NOT NULL,
      hop integer NOT NULL,
      observed jsonb NOT NULL DEFAULT '{}'::jsonb,
      derived_phase text NOT NULL DEFAULT 'gan',
      gate_verdict text,
      action text NOT NULL,
      detail jsonb,
      created_at timestamptz DEFAULT now()
    );

    CREATE TEMP TABLE harness_attempts (
      id uuid PRIMARY KEY,
      run_id uuid NOT NULL,
      hop integer NOT NULL,
      phase text NOT NULL,
      role text NOT NULL,
      provider text NOT NULL DEFAULT 'codex',
      account_id text,
      machine_id text,
      skill_name text,
      skill_version text,
      skill_digest text,
      task_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
      result jsonb,
      status text NOT NULL DEFAULT 'queued',
      provider_session_id text,
      callback_secret_hash text NOT NULL DEFAULT repeat('a', 64),
      lease_owner text,
      lease_expires_at timestamptz,
      heartbeat_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      error_code text,
      error_message text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `);
}

async function dropKernelTempSchema() {
  await client.query(`
    DROP TABLE IF EXISTS harness_attempts;
    DROP TABLE IF EXISTS orchestrator_decision_log;
    DROP TABLE IF EXISTS initiative_runs;
    DROP TABLE IF EXISTS initiative_contracts;
    DROP TABLE IF EXISTS tasks;
    DROP SEQUENCE IF EXISTS kernel_run_seq;
  `);
}

async function insertTask(payload = {}) {
  const row = taskRow(payload);
  await client.query(
    `INSERT INTO tasks (id, title, task_type, status, payload, ability_id)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid)`,
    [row.id, row.title, row.task_type, row.status, JSON.stringify(row.payload), row.ability_id],
  );
  return row;
}

async function insertApprovedContracts() {
  await client.query(
    `INSERT INTO initiative_contracts
       (id, initiative_id, version, status, branch, approved_at, prd_content, contract_content)
     VALUES
       ($1::uuid, $3::uuid, 1, 'approved', 'cp-harness-propose-r1-f09c9e31-a1', now() - interval '2 hours', '# old', '# old contract'),
       ($2::uuid, $3::uuid, 2, 'approved', 'cp-harness-propose-r2-f09c9e31-a1', now() - interval '1 hour', '# prd', '# contract')`,
    [APPROVED_V1, APPROVED_V2, INITIATIVE_ID],
  );
}

async function insertDecoyTaskAndContract() {
  await client.query(
    `INSERT INTO tasks (id, title, task_type, status, payload)
     VALUES ($1::uuid, 'decoy task', 'harness_initiative', 'queued',
             $2::jsonb)`,
    [DECOY_TASK_ID, JSON.stringify({
      harness_runtime: 'kernel-v1',
      journey_id: JOURNEY_ID,
    })],
  );
  await client.query(
    `INSERT INTO initiative_contracts
       (id, initiative_id, version, status, branch, approved_at, prd_content, contract_content)
     VALUES
       ($1::uuid, $2::uuid, 99, 'approved', 'cp-harness-propose-r99-decoy',
        now(), '# decoy prd', '# decoy contract')`,
    [DECOY_APPROVED_ID, DECOY_TASK_ID],
  );
}

function createBootstrapTransactionProbe({ failRunInsert = false } = {}) {
  const events = [];
  let connected = false;
  let connectCount = 0;
  let transactionClientId = null;

  const runQuery = (channel, clientId) => async (text, params) => {
    const sql = String(text);
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const eventBase = { sql: normalized, channel, clientId };
    if (/^BEGIN\b/i.test(normalized)) {
      events.push({ type: 'BEGIN', ...eventBase });
      if (channel !== 'txClient') {
        throw new Error('bootstrap_transaction_control_must_use_txClient');
      }
      transactionClientId = clientId;
      return client.query(text, params);
    }
    if (/^COMMIT\b/i.test(normalized)) {
      events.push({ type: 'COMMIT', ...eventBase });
      if (channel !== 'txClient' || transactionClientId !== clientId) {
        throw new Error('bootstrap_transaction_control_changed_txClient');
      }
      const result = await client.query(text, params);
      transactionClientId = null;
      return result;
    }
    if (/^ROLLBACK\b/i.test(normalized)) {
      events.push({ type: 'ROLLBACK', ...eventBase });
      if (channel !== 'txClient' || transactionClientId !== clientId) {
        throw new Error('bootstrap_transaction_control_changed_txClient');
      }
      const result = await client.query(text, params);
      transactionClientId = null;
      return result;
    }

    const selectsApproved = /initiative_contracts/i.test(normalized) && /approved/i.test(normalized);
    const insertsRun = /INSERT INTO initiative_runs/i.test(normalized);
    const updatesTask = /UPDATE tasks/i.test(normalized);
    const selectsActiveRun = /^SELECT\b/i.test(normalized)
      && /FROM initiative_runs/i.test(normalized)
      && /phase NOT IN/i.test(normalized);
    const inTransaction = channel === 'txClient' && transactionClientId === clientId;
    if (selectsApproved) events.push({ type: 'SELECT_APPROVED', ...eventBase, inTransaction });
    if (insertsRun) events.push({ type: 'INSERT_RUN', ...eventBase, inTransaction });
    if (updatesTask) events.push({ type: 'UPDATE_TASK', ...eventBase, inTransaction });
    if (!selectsApproved && !insertsRun && !updatesTask) {
      events.push({ type: 'QUERY', ...eventBase, inTransaction });
    }
    if (channel === 'pool' && (!selectsActiveRun || connected)) {
      throw new Error('bootstrap_pool_query_only_allows_pre_transaction_active_run_check');
    }
    if ((selectsApproved || insertsRun || updatesTask) && !inTransaction) {
      throw new Error('bootstrap_business_sql_must_use_same_txClient');
    }
    if (failRunInsert && insertsRun && channel === 'txClient') {
      throw new Error('injected_bootstrap_run_insert_failure');
    }
    return client.query(text, params);
  };

  return {
    events,
    query: runQuery('pool', 'pool'),
    async connect() {
      connected = true;
      const clientId = `txClient-${++connectCount}`;
      events.push({ type: 'CONNECT', channel: 'txClient', clientId });
      return {
        query: runQuery('txClient', clientId),
        release() {
          events.push({ type: 'RELEASE', channel: 'txClient', clientId });
        },
      };
    },
  };
}

function expectAtomicBootstrap(events, terminalType = 'COMMIT') {
  const indexOf = (type) => events.findIndex((event) => event.type === type);
  const connect = indexOf('CONNECT');
  const begin = indexOf('BEGIN');
  const selectApproved = indexOf('SELECT_APPROVED');
  const updateTask = indexOf('UPDATE_TASK');
  const insertRun = indexOf('INSERT_RUN');
  const terminal = indexOf(terminalType);

  expect(connect).toBeGreaterThanOrEqual(0);
  expect(begin).toBeGreaterThan(connect);
  expect(selectApproved).toBeGreaterThan(begin);
  expect(updateTask).toBeGreaterThan(selectApproved);
  expect(insertRun).toBeGreaterThan(updateTask);
  expect(terminal).toBeGreaterThan(insertRun);
  const txClientId = events[connect].clientId;
  for (const eventIndex of [begin, selectApproved, updateTask, insertRun, terminal]) {
    expect(events[eventIndex]).toMatchObject({
      channel: 'txClient',
      clientId: txClientId,
    });
  }
  for (const eventIndex of [selectApproved, updateTask, insertRun]) {
    expect(events[eventIndex].inTransaction).toBe(true);
  }
  expect(events.some((event) => (
    event.channel === 'pool'
      && ['SELECT_APPROVED', 'UPDATE_TASK', 'INSERT_RUN'].includes(event.type)
  ))).toBe(false);
}

function execCmdForFailedPr(failureName) {
  return (cmd) => {
    if (cmd.startsWith('gh pr view')) {
      return JSON.stringify({
        state: 'OPEN',
        mergeStateStatus: 'DIRTY',
        headRefName: 'kernel-durable-resume',
        headRefOid: 'sha-repeat',
        statusCheckRollup: [
          { name: failureName, conclusion: 'FAILURE' },
        ],
      });
    }
    return '';
  };
}

function execCmdForOpenPr(cmd) {
  return execCmdForFailedPr('kernel:duplicate-generator-signature')(cmd);
}

function durableRecoveryInput(overrides = {}) {
  return {
    pool: client,
    taskId: TASK_ID,
    runId: CURRENT_RUN_ID,
    leaseOwner: 'watchdog:test',
    leaseSeconds: 180,
    providerRegistry: createProviderRegistry([codexAdapter]),
    launchResume: async () => ({ pid: 4242 }),
    execCmd: execCmdForFailedPr('kernel:orphan-recovery'),
    fileExists: () => true,
    readFile: () => '{}',
    readAuthCircuit: async () => [],
    ...overrides,
  };
}

async function observedFor(runId, execCmd = () => '', overrides = {}) {
  const observed = await collectGroundTruth({
    pool: client,
    execCmd,
    fileExists: overrides.fileExists ?? (() => true),
    readFile: () => '{}',
    readAuthCircuit: async () => [],
  }, {
    taskId: TASK_ID,
    runId,
    prdPath: 'sprints/07251915-kernel-f09c9e31/sprint-prd.md',
  });
  const counters = deriveCounters(observed.decisionLog, {
    proposeBranchMaxRn: observed.proposeBranchRn,
  });
  return {
    observed,
    decision: derive({
      ...observed,
      noProgress: counters.noProgress,
      noProgressReason: counters.noProgressReason,
      counters: {
        ...counters,
        ganCostUsd: Number(observed.run.cost_usd ?? 0),
      },
    }),
  };
}

describe('Kernel durable resume [BEHAVIOR]', () => {
  beforeEach(async () => {
    client = await pool.connect();
    await createKernelTempSchema();
  });

  afterEach(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await dropKernelTempSchema();
      client.release();
      client = null;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('后续 run 继承 latest approved contract id/version/branch 且 derive 不再派 proposer/reviewer', async () => {
    const task = await insertTask();
    await insertApprovedContracts();
    await insertDecoyTaskAndContract();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'done', $4::uuid, 'v2', now())`,
      [OLD_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID],
    );

    const bootstrapPool = createBootstrapTransactionProbe();
    const result = await spawnSkillRelaySession(task, {
      pool: bootstrapPool,
      now: () => new Date('2026-07-25T19:15:00Z'),
      ensureWt: async () => '/tmp/kernel-durable-resume-worktree',
      launchKernel: async () => ({ pid: 4242 }),
    });

    expect(result).toMatchObject({ ok: true, mode: 'kernel-v1' });
    const { rows } = await client.query(
      `SELECT r.initiative_id, r.journey_id, r.contract_id, c.version, c.branch
         FROM initiative_runs r
         LEFT JOIN initiative_contracts c ON c.id = r.contract_id
        WHERE r.id = $1::uuid`,
      [result.runId],
    );
    expect(rows[0]).toMatchObject({
      initiative_id: TASK_ID,
      journey_id: JOURNEY_ID,
      contract_id: APPROVED_V2,
      version: 2,
      branch: 'cp-harness-propose-r2-f09c9e31-a1',
    });
    expect(rows[0].contract_id).not.toBe(DECOY_APPROVED_ID);
    expectAtomicBootstrap(bootstrapPool.events);

    const { decision } = await observedFor(result.runId);
    expect(decision.action).not.toBe('spawn:proposer');
    expect(decision.action).not.toBe('spawn:reviewer');
    expect(decision.action).toBe('spawn:generator');
  });

  it('首个 run 无 approved contract 时维持首次 GAN 路径且不继承其他 task 合同', async () => {
    const task = await insertTask();
    await insertDecoyTaskAndContract();

    const bootstrapPool = createBootstrapTransactionProbe();
    const result = await spawnSkillRelaySession(task, {
      pool: bootstrapPool,
      now: () => new Date('2026-07-25T19:16:00Z'),
      ensureWt: async () => '/tmp/kernel-durable-resume-first-run',
      launchKernel: async () => ({ pid: 4243 }),
    });

    expect(result).toMatchObject({ ok: true, mode: 'kernel-v1' });
    const { rows } = await client.query(
      `SELECT initiative_id, journey_id, contract_id
         FROM initiative_runs
        WHERE id=$1::uuid`,
      [result.runId],
    );
    expect(rows[0]).toMatchObject({
      initiative_id: TASK_ID,
      journey_id: JOURNEY_ID,
      contract_id: null,
    });
    expectAtomicBootstrap(bootstrapPool.events);

    const { observed, decision } = await observedFor(result.runId);
    expect(observed.contract.approved).toBe(false);
    expect(observed.contract.id).toBeNull();
    expect(decision.action).toBe('spawn:proposer');
  });

  it('run bootstrap 中途失败时生产事务回滚且不留下半写', async () => {
    const task = await insertTask();
    await insertApprovedContracts();
    const beforeTask = await client.query(
      'SELECT payload FROM tasks WHERE id=$1::uuid',
      [TASK_ID],
    );
    const bootstrapPool = createBootstrapTransactionProbe({ failRunInsert: true });

    await expect(spawnSkillRelaySession(task, {
      pool: bootstrapPool,
      now: () => new Date('2026-07-25T19:17:00Z'),
      ensureWt: async () => '/tmp/kernel-durable-resume-rollback',
      launchKernel: async () => ({ pid: 4244 }),
    })).rejects.toThrow('injected_bootstrap_run_insert_failure');

    expectAtomicBootstrap(bootstrapPool.events, 'ROLLBACK');
    expect(bootstrapPool.events.some((event) => event.type === 'COMMIT')).toBe(false);
    const runs = await client.query(
      'SELECT count(*)::int AS n FROM initiative_runs WHERE current_task_id=$1::uuid',
      [TASK_ID],
    );
    expect(runs.rows[0].n).toBe(0);
    const afterTask = await client.query(
      'SELECT payload FROM tasks WHERE id=$1::uuid',
      [TASK_ID],
    );
    expect(afterTask.rows[0].payload).toEqual(beforeTask.rows[0].payload);
  });

  it('ground truth 从历史 approved contract 恢复当前 run，已确认合同里程碑不降级', async () => {
    await insertTask();
    await insertApprovedContracts();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version)
       VALUES ($1::uuid, $2::uuid, NULL, 'gan', $3::uuid, 'v2')`,
      [CURRENT_RUN_ID, INITIATIVE_ID, TASK_ID],
    );
    await client.query(
      `INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action)
       VALUES ($1::uuid, 1, $2::jsonb, 'planning', 'spawn:planner')`,
      [CURRENT_RUN_ID, JSON.stringify({ prdExists: true })],
    );

    const { observed, decision } = await observedFor(CURRENT_RUN_ID);

    expect(observed.contract.approved).toBe(true);
    expect(observed.contract.id).toBe(APPROVED_V2);
    expect(observed.contract.row).toMatchObject({
      version: 2,
      branch: 'cp-harness-propose-r2-f09c9e31-a1',
    });
    expect(decision.action).not.toBe('spawn:proposer');
    expect(decision.action).not.toBe('spawn:reviewer');
  });

  it('Brain restart 后 PRD/PR/合同里程碑单调恢复，下一角色与不中断基线一致', async () => {
    await insertTask();
    await insertApprovedContracts();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, pr_url)
       VALUES
         ($1::uuid, $3::uuid, $4::uuid, 'generate', $5::uuid, 'v2', $6),
         ($2::uuid, $3::uuid, NULL, 'generate', $5::uuid, 'v2', NULL)`,
      [OLD_RUN_ID, CURRENT_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID, PR_URL],
    );
    await client.query(
      `INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action)
       VALUES ($1::uuid, 3, $2::jsonb, 'generate', 'spawn:evaluator')`,
      [CURRENT_RUN_ID, JSON.stringify({
        prdExists: true,
        pr: { url: PR_URL, head_sha: 'sha-restored' },
        contract: { approved: true, id: APPROVED_V2 },
      })],
    );

    const execCmd = (cmd) => {
      if (cmd.startsWith('gh pr view')) {
        return JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'DIRTY',
          headRefName: 'kernel-durable-resume',
          headRefOid: 'sha-restored',
          statusCheckRollup: [
            { name: 'kernel:durable-resume', conclusion: 'SUCCESS' },
          ],
        });
      }
      return '';
    };

    const uninterrupted = await observedFor(OLD_RUN_ID, execCmd, {
      fileExists: () => true,
    });
    const resumed = await observedFor(CURRENT_RUN_ID, execCmd, {
      fileExists: () => false,
    });

    expect(resumed.observed.prdExists).toBe(true);
    expect(resumed.observed.contract.approved).toBe(true);
    expect(resumed.observed.contract.id).toBe(APPROVED_V2);
    expect(resumed.observed.pr).toMatchObject({
      url: PR_URL,
      state: 'OPEN',
      head_sha: 'sha-restored',
      ci: 'pass',
    });
    expect(resumed.decision.action).toBe(uninterrupted.decision.action);
    expect(resumed.decision.action).not.toBe('spawn:planner');
    expect(resumed.decision.action).not.toBe('spawn:proposer');
    expect(resumed.decision.action).not.toBe('spawn:reviewer');
  });

  it('跨 run 同结构化 failure signature 重现时不再派 generator', async () => {
    await insertTask();
    await insertApprovedContracts();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, pr_url, completed_at)
       VALUES
         ($1::uuid, $3::uuid, $4::uuid, 'failed', $5::uuid, 'v2', 'https://github.com/perfectuser21/cecelia/pull/100', now() - interval '1 hour'),
         ($2::uuid, $3::uuid, $4::uuid, 'generate', $5::uuid, 'v2', 'https://github.com/perfectuser21/cecelia/pull/101', NULL)`,
      [OLD_RUN_ID, CURRENT_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID],
    );
    await client.query(
      `INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action, detail)
       VALUES ($1::uuid, 10, $2::jsonb, 'generate', 'spawn:generator-fix', $3::jsonb)`,
      [
        OLD_RUN_ID,
        JSON.stringify({
          pr: { head_sha: 'sha-repeat' },
          failure_class: 'product_failure',
          failure_set: ['kernel:duplicate-generator-signature'],
          failure_set_key: 'kernel:duplicate-generator-signature',
        }),
        JSON.stringify({ reason: 'ci_fail' }),
      ],
    );

    const { decision } = await observedFor(CURRENT_RUN_ID, execCmdForOpenPr);

    expect(['wait:human_review', 'mark_failed']).toContain(decision.action);
    expect(decision.action).not.toBe('spawn:generator');
    expect(decision.action).not.toBe('spawn:generator-fix');
  });

  it('跨 run 不同 failure signature 首次出现时仍派 generator-fix', async () => {
    await insertTask();
    await insertApprovedContracts();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, pr_url, completed_at)
       VALUES
         ($1::uuid, $3::uuid, $4::uuid, 'failed', $5::uuid, 'v2', 'https://github.com/perfectuser21/cecelia/pull/100', now() - interval '1 hour'),
         ($2::uuid, $3::uuid, $4::uuid, 'generate', $5::uuid, 'v2', 'https://github.com/perfectuser21/cecelia/pull/101', NULL)`,
      [OLD_RUN_ID, CURRENT_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID],
    );
    await client.query(
      `INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action, detail)
       VALUES ($1::uuid, 10, $2::jsonb, 'generate', 'spawn:generator-fix', $3::jsonb)`,
      [
        OLD_RUN_ID,
        JSON.stringify({
          pr: { head_sha: 'sha-old-a' },
          failure_class: 'product_failure',
          failure_set: ['kernel:signature-a'],
          failure_set_key: 'kernel:signature-a',
        }),
        JSON.stringify({ reason: 'ci_fail' }),
      ],
    );

    const recovery = await recoverDurableRun(durableRecoveryInput({
      execCmd: execCmdForFailedPr('kernel:signature-b'),
    }));

    expect(recovery).toMatchObject({
      outcome: 'reconciled',
      terminated_attempt_id: null,
      decision: {
        action: 'spawn:generator-fix',
      },
    });
  });

  it('稳定恢复原语：expired lease 有 provider session 时调用真实 provider resume 并恢复原 attempt', async () => {
    await insertTask();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, phase, current_task_id, orchestrator_version)
       VALUES ($1::uuid, $2::uuid, 'generate', $3::uuid, 'v2')`,
      [CURRENT_RUN_ID, INITIATIVE_ID, TASK_ID],
    );
    await client.query(
      `INSERT INTO harness_attempts
         (id, run_id, hop, phase, role, status, provider_session_id, lease_owner, lease_expires_at, task_bundle)
       VALUES
         ('30000000-0000-4000-8000-000000000001'::uuid, $1::uuid, 7, 'generate', 'generator',
          'running', 'provider-session-1', 'old-worker', now() - interval '5 minutes', '{}'::jsonb)`,
      [CURRENT_RUN_ID],
    );

    const before = await client.query(
      'SELECT count(*)::int AS n FROM harness_attempts WHERE run_id=$1::uuid',
      [CURRENT_RUN_ID],
    );

    let launched = null;
    const recovery = await recoverDurableRun(durableRecoveryInput({
      launchResume: async ({ attempt, spec }) => {
        launched = { attempt, spec };
        return { pid: 4242 };
      },
    }));

    const after = await client.query(
      `SELECT id, status, lease_owner, lease_expires_at, provider_session_id
         FROM harness_attempts
        WHERE run_id=$1::uuid`,
      [CURRENT_RUN_ID],
    );
    expect(recovery).toMatchObject({
      outcome: 'resumed',
      attempt_id: '30000000-0000-4000-8000-000000000001',
      provider_session_id: 'provider-session-1',
      launch_result: { pid: 4242 },
    });
    expect(launched.attempt).toMatchObject({
      id: '30000000-0000-4000-8000-000000000001',
      status: 'starting',
      lease_owner: 'watchdog:test',
      provider_session_id: 'provider-session-1',
    });
    expect(new Date(launched.attempt.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(launched.spec).toMatchObject({ provider: 'codex', command: 'codex' });
    expect(launched.spec.args).toEqual(expect.arrayContaining([
      'exec', 'resume', 'provider-session-1',
    ]));
    expect(after.rows).toHaveLength(before.rows[0].n);
    expect(after.rows[0]).toMatchObject({
      id: '30000000-0000-4000-8000-000000000001',
      status: 'starting',
      lease_owner: 'watchdog:test',
      provider_session_id: 'provider-session-1',
    });
    expect(new Date(after.rows[0].lease_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('稳定恢复原语：未过期 running attempt 不被本 worker reclaim 或 resume', async () => {
    await insertTask();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, phase, current_task_id, orchestrator_version)
       VALUES ($1::uuid, $2::uuid, 'generate', $3::uuid, 'v2')`,
      [CURRENT_RUN_ID, INITIATIVE_ID, TASK_ID],
    );
    await client.query(
      `INSERT INTO harness_attempts
         (id, run_id, hop, phase, role, status, provider_session_id, lease_owner, lease_expires_at, task_bundle)
       VALUES
         ('30000000-0000-4000-8000-000000000003'::uuid, $1::uuid, 9, 'generate', 'generator',
          'running', 'provider-session-live', 'active-worker', now() + interval '5 minutes', '{}'::jsonb)`,
      [CURRENT_RUN_ID],
    );

    let launches = 0;
    const recovery = await recoverDurableRun(durableRecoveryInput({
      launchResume: async () => {
        launches += 1;
        return { pid: 4245 };
      },
    }));

    expect(recovery).toMatchObject({
      outcome: 'reconciled',
      terminated_attempt_id: null,
    });
    expect(launches).toBe(0);
    const { rows } = await client.query(
      `SELECT id, status, lease_owner, lease_expires_at, provider_session_id
         FROM harness_attempts
        WHERE run_id=$1::uuid`,
      [CURRENT_RUN_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '30000000-0000-4000-8000-000000000003',
      status: 'running',
      lease_owner: 'active-worker',
      provider_session_id: 'provider-session-live',
    });
    expect(new Date(rows[0].lease_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('稳定恢复原语：无 provider session 时自动终结 orphan 后从 DB/GitHub 真相推导', async () => {
    await insertTask();
    await insertApprovedContracts();
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, pr_url)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'generate', $4::uuid, 'v2', $5)`,
      [CURRENT_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID, PR_URL],
    );
    await client.query(
      `INSERT INTO harness_attempts
         (id, run_id, hop, phase, role, status, provider_session_id, lease_owner, lease_expires_at, task_bundle)
       VALUES
         ('30000000-0000-4000-8000-000000000002'::uuid, $1::uuid, 8, 'generate', 'generator',
          'running', NULL, 'old-worker', now() - interval '5 minutes', '{}'::jsonb)`,
      [CURRENT_RUN_ID],
    );

    const recovery = await recoverDurableRun(durableRecoveryInput());

    const { rows } = await client.query(
      'SELECT status, error_code, completed_at IS NOT NULL AS terminal FROM harness_attempts WHERE id=$1::uuid',
      ['30000000-0000-4000-8000-000000000002'],
    );

    expect(rows[0]).toMatchObject({
      status: 'failed',
      error_code: 'orphan_without_provider_session',
      terminal: true,
    });
    const count = await client.query(
      'SELECT count(*)::int AS n FROM harness_attempts WHERE run_id=$1::uuid',
      [CURRENT_RUN_ID],
    );
    expect(count.rows[0].n).toBe(1);
    expect(recovery).toMatchObject({
      outcome: 'reconciled',
      terminated_attempt_id: '30000000-0000-4000-8000-000000000002',
      error_code: 'orphan_without_provider_session',
      decision: {
        action: 'spawn:generator-fix',
      },
    });
  });
});
