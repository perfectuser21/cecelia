import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

const TASK_ID = 'f09c9e31-ed78-4af4-a1b6-88241bc486c5';
const INITIATIVE_ID = '741d4acc-9ca8-4545-a971-efa12fce8150';
const APPROVED_V1 = '10000000-0000-4000-8000-000000000001';
const APPROVED_V2 = '10000000-0000-4000-8000-000000000002';
const OLD_RUN_ID = '20000000-0000-4000-8000-000000000001';
const CURRENT_RUN_ID = '20000000-0000-4000-8000-000000000002';

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
    ) ON COMMIT DROP;

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
    ) ON COMMIT DROP;

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
    ) ON COMMIT DROP;

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
    ) ON COMMIT DROP;

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
    ) ON COMMIT DROP;
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

function execCmdForOpenPr(cmd) {
  if (cmd.startsWith('gh pr view')) {
    return JSON.stringify({
      state: 'OPEN',
      mergeStateStatus: 'DIRTY',
      headRefName: 'kernel-durable-resume',
      headRefOid: 'sha-repeat',
      statusCheckRollup: [
        { name: 'kernel:duplicate-generator-signature', conclusion: 'FAILURE' },
      ],
    });
  }
  return '';
}

async function observedFor(runId, execCmd = () => '') {
  const observed = await collectGroundTruth({
    pool: client,
    execCmd,
    fileExists: () => true,
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
    await client.query('BEGIN');
    await createKernelTempSchema();
  });

  afterEach(async () => {
    if (client) {
      await client.query('ROLLBACK');
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
    await client.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, contract_id, phase, current_task_id, orchestrator_version, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'done', $4::uuid, 'v2', now())`,
      [OLD_RUN_ID, INITIATIVE_ID, APPROVED_V2, TASK_ID],
    );

    const result = await spawnSkillRelaySession(task, {
      pool: client,
      now: () => new Date('2026-07-25T19:15:00Z'),
      ensureWt: async () => '/tmp/kernel-durable-resume-worktree',
      launchKernel: async () => ({ pid: 4242 }),
    });

    expect(result).toMatchObject({ ok: true, mode: 'kernel-v1' });
    const { rows } = await client.query(
      `SELECT r.contract_id, c.version, c.branch
         FROM initiative_runs r
         LEFT JOIN initiative_contracts c ON c.id = r.contract_id
        WHERE r.id = $1::uuid`,
      [result.runId],
    );
    expect(rows[0]).toMatchObject({
      contract_id: APPROVED_V2,
      version: 2,
      branch: 'cp-harness-propose-r2-f09c9e31-a1',
    });

    const { decision } = await observedFor(result.runId);
    expect(decision.action).not.toBe('spawn:proposer');
    expect(decision.action).not.toBe('spawn:reviewer');
    expect(decision.action).toBe('spawn:generator');
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

  it('expired lease 有 provider session 时恢复原 attempt，不创建新 attempt', async () => {
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

    const resume = await import('../../../packages/brain/src/orchestrator/attempt-store.js')
      .then(({ createAttemptStore }) => createAttemptStore(client).reclaim(
        '30000000-0000-4000-8000-000000000001',
        { leaseOwner: 'watchdog:test', leaseSeconds: 180 },
      ));

    const after = await client.query(
      'SELECT count(*)::int AS n, max(provider_session_id) AS session_id FROM harness_attempts WHERE run_id=$1::uuid',
      [CURRENT_RUN_ID],
    );
    expect(resume).toMatchObject({ id: '30000000-0000-4000-8000-000000000001' });
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].session_id).toBe('provider-session-1');
  });

  it('无 provider session 时先结构化终结 orphan attempt，再从 DB/GitHub 真相推导', async () => {
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
         ('30000000-0000-4000-8000-000000000002'::uuid, $1::uuid, 8, 'generate', 'generator',
          'running', NULL, 'old-worker', now() - interval '5 minutes', '{}'::jsonb)`,
      [CURRENT_RUN_ID],
    );

    const { createAttemptStore } = await import('../../../packages/brain/src/orchestrator/attempt-store.js');
    await createAttemptStore(client).fail(
      '30000000-0000-4000-8000-000000000002',
      { code: 'orphan_without_provider_session', message: 'no provider session to resume' },
    );

    const { rows } = await client.query(
      'SELECT status, error_code, completed_at IS NOT NULL AS terminal FROM harness_attempts WHERE id=$1::uuid',
      ['30000000-0000-4000-8000-000000000002'],
    );

    expect(rows[0]).toMatchObject({
      status: 'failed',
      error_code: 'orphan_without_provider_session',
      terminal: true,
    });
  });
});
