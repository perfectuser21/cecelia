import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pool: null, spawnRelay: vi.fn() }));

vi.mock('../../db.js', () => ({
  default: {
    query: (...args) => state.pool.query(...args),
    connect: (...args) => state.pool.connect(...args),
  },
}));
vi.mock('../../harness-skill-relay.js', () => ({
  deriveGear: (task) => {
    const gear = task?.payload?.gear;
    if (gear == null || ['default', 'hotfix', 'segmented'].includes(gear)) return gear ?? 'default';
    throw new Error(`invalid_gear: ${gear}`);
  },
  spawnSkillRelaySession: (...args) => state.spawnRelay(...args),
}));
vi.mock('../../okr-initiative-sync.js', () => ({ syncOkrInitiativeStatus: vi.fn() }));
vi.mock('../../events/initiativeRunEvents.js', () => ({ writeInitiativeRunEvent: vi.fn() }));

import { DB_DEFAULTS } from '../../db-config.js';
import { triggerCeceliaRun } from '../../executor.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^executor_authority_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedTaskWithRun(phase) {
  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const runId = randomUUID();
  const title = `authority ${phase} ${taskId}`;
  const terminal = ['done', 'failed'].includes(phase);
  const taskStatus = phase === 'done' ? 'completed' : terminal ? 'failed' : 'in_progress';
  const payload = {
    orchestrator: 'skill-relay',
    harness_runtime: 'kernel-v1',
    initiative_id: initiativeId,
  };
  await testPool.query(
    `INSERT INTO tasks(
       id,title,description,status,priority,task_type,payload,claimed_by,claimed_at
     ) VALUES($1,$2,$3,$4,'P0','harness_initiative',$5::jsonb,'brain-tick-7',NOW())`,
    [taskId, title, `executor authority ${phase}`, taskStatus, JSON.stringify(payload)],
  );
  if (terminal) {
    await testPool.query(
      `INSERT INTO initiative_runs(
         id,initiative_id,phase,current_task_id,orchestrator_version,created_source,
         record_trust_status,impact_contract_policy,impact_contract_policy_reason
       ) VALUES($1,$2,$3,$4,'v2','kernel_dispatch','trusted',
         'legacy_exempt','executor authority reconciliation fixture')`,
      [runId, initiativeId, phase, taskId],
    );
  } else {
    await seedOwnedActiveV2Run(testPool, {
      runId,
      initiativeId,
      taskId,
      phase,
      impactContractPolicyReason: 'executor authority reconciliation fixture',
    });
  }
  return {
    runId,
    task: {
      id: taskId,
      task_type: 'harness_initiative',
      title,
      status: taskStatus,
      payload,
    },
  };
}

beforeAll(async () => {
  databaseName = `executor_authority_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  state.pool = testPool;
}, 30_000);

beforeEach(() => {
  state.spawnRelay.mockReset();
});

afterAll(async () => {
  if (testPool) await testPool.end();
  state.pool = null;
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('executor Kernel authority reconciliation on PostgreSQL', () => {
  it('router exception reads back the exact active v2 run by current task id', async () => {
    const { task, runId } = await seedTaskWithRun('generate');
    state.spawnRelay.mockRejectedValueOnce(new Error('post_create_transport_failed'));

    const result = await triggerCeceliaRun(task);

    expect(result).toMatchObject({
      success: true,
      taskId: task.id,
      runId,
      deferred: true,
      kernelAuthority: 'active',
      authorityExists: true,
    });
  });

  it.each(['done', 'failed'])(
    'router exception reads back the exact terminal v2 run (%s)',
    async (phase) => {
      const { task, runId } = await seedTaskWithRun(phase);
      state.spawnRelay.mockRejectedValueOnce(new Error('post_terminal_callback_failed'));

      const result = await triggerCeceliaRun(task);

      expect(result).toMatchObject({
        success: false,
        taskId: task.id,
        runId,
        kernelAuthority: 'terminal',
        authorityExists: true,
        terminal: true,
        runPhase: phase,
      });
    },
  );

  it('terminalized relay result is accepted only after exact terminal run read-back', async () => {
    const { task, runId } = await seedTaskWithRun('failed');
    state.spawnRelay.mockResolvedValueOnce({
      ok: false,
      mode: 'kernel-v1',
      runId,
      terminalized: true,
      error: 'kernel launch failed',
    });

    const result = await triggerCeceliaRun(task);

    expect(result).toMatchObject({
      success: false,
      taskId: task.id,
      runId,
      kernelAuthority: 'terminal',
      authorityExists: true,
      terminal: true,
      runPhase: 'failed',
    });
  });

  it('terminalized relay result for an active run remains authority-unknown', async () => {
    const { task, runId } = await seedTaskWithRun('generate');
    state.spawnRelay.mockResolvedValueOnce({
      ok: false,
      mode: 'kernel-v1',
      runId,
      terminalized: true,
      error: 'kernel launch failed',
    });

    const result = await triggerCeceliaRun(task);

    expect(result).toMatchObject({
      success: false,
      taskId: task.id,
      runId,
      authorityUnknown: true,
      reason: 'kernel_authority_reconciliation_unavailable',
    });
    expect(result.kernelAuthority).toBeUndefined();
  });

  it('router exception with no exact v2 run remains no-authority', async () => {
    const taskId = randomUUID();
    const payload = {
      orchestrator: 'skill-relay',
      harness_runtime: 'kernel-v1',
      initiative_id: randomUUID(),
    };
    await testPool.query(
      `INSERT INTO tasks(id,title,status,priority,task_type,payload)
       VALUES($1,'no authority','in_progress','P0','harness_initiative',$2::jsonb)`,
      [taskId, JSON.stringify(payload)],
    );
    state.spawnRelay.mockRejectedValueOnce(new Error('impact_capability_missing'));

    const result = await triggerCeceliaRun({
      id: taskId,
      task_type: 'harness_initiative',
      title: 'no authority',
      status: 'in_progress',
      payload,
    });

    expect(result).toMatchObject({
      success: false,
      taskId,
      reason: 'kernel_authority_not_created',
    });
    expect(result.runId).toBeUndefined();
  });

  it('normal pre-run terminal result verifies terminal task truth without a run', async () => {
    const taskId = randomUUID();
    const payload = {
      orchestrator: 'skill-relay',
      harness_runtime: 'kernel-v1',
      initiative_id: randomUUID(),
      gear: 'impossible-gear',
    };
    await testPool.query(
      `INSERT INTO tasks(id,title,status,priority,task_type,payload,claimed_by,claimed_at)
       VALUES($1,'invalid gear','in_progress','P0','harness_initiative',$2::jsonb,
         'brain-tick-7',NOW())`,
      [taskId, JSON.stringify(payload)],
    );

    const result = await triggerCeceliaRun({
      id: taskId,
      task_type: 'harness_initiative',
      title: 'invalid gear',
      status: 'in_progress',
      payload,
    });

    expect(result).toMatchObject({
      success: false,
      taskId,
      reason: 'kernel_pre_run_terminal',
      taskTerminal: true,
      terminal: true,
      taskStatus: 'failed',
    });
    expect(result.runId).toBeUndefined();
    const persisted = await testPool.query(
      'SELECT status,claimed_by FROM tasks WHERE id=$1',
      [taskId],
    );
    expect(persisted.rows[0]).toEqual({ status: 'failed', claimed_by: 'brain-tick-7' });
  });
});
