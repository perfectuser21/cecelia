import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pool: null,
  taskId: null,
  trigger: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  default: {
    query: (...args) => state.pool.query(...args),
    connect: (...args) => state.pool.connect(...args),
  },
}));
vi.mock('../../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: vi.fn(async () => {
    const result = await state.pool.query(
      `SELECT id,title,description,prd_content,status,priority,started_at,updated_at,
              payload,queued_at,task_type,created_at,metadata,project_id
         FROM tasks WHERE id=$1 AND status='queued' AND claimed_by IS NULL`,
      [state.taskId],
    );
    return result.rows[0] ?? null;
  }),
  processCortexTask: vi.fn(),
}));
vi.mock('../../actions.js', () => ({
  updateTask: vi.fn(async ({ task_id: taskId, status }) => {
    const updated = await state.pool.query(
      'UPDATE tasks SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id',
      [taskId, status],
    );
    return { success: updated.rowCount === 1 };
  }),
}));
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: (...args) => state.trigger(...args),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
}));
vi.mock('../../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(async () => ({
    dispatchAllowed: true,
    budgetState: { state: 'abundant' },
    taskPool: { budget: 5, available: 5 },
    user: { mode: 'absent', used: 0 },
  })),
  harnessSlotCheck: vi.fn(async () => ({
    allow: true,
    reason: 'ok',
    containers: 0,
    inflight: 0,
    stale: false,
    cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 },
  })),
}));
vi.mock('../../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({})),
}));
vi.mock('../../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));
vi.mock('../../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: false, drain_mode_requested: false })),
}));
vi.mock('../../event-bus.js', () => ({ emit: (...args) => state.emit(...args) }));
vi.mock('../../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
}));
vi.mock('../../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn() }));
vi.mock('../../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn() }));
vi.mock('../../tick-stats.js', () => ({ incrementActionsToday: vi.fn(async () => {}) }));
vi.mock('../../account-usage.js', () => ({ proactiveTokenCheck: vi.fn(async () => {}) }));
vi.mock('../../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn(async () => ({ allow: true, priorityFilter: null, bestPct: 0 })),
}));
vi.mock('../../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn(async () => ({ passed: true, issues: [], suggestions: [] })),
  alertOnPreFlightFail: vi.fn(),
  getPreFlightStats: vi.fn(async () => ({})),
}));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../../anchor-check.js', () => ({ checkAnchor: vi.fn(() => ({ blocked: false })) }));
vi.mock('../../dispatch-allocation-guide.js', () => ({
  applyDispatchAllocationGuide: vi.fn((task) => ({ task, changed: false, payloadPatch: null })),
}));
vi.mock('../../llm-capacity.js', () => ({ getLlmCapacitySnapshot: vi.fn(async () => ({})) }));

import { DB_DEFAULTS } from '../../db-config.js';
import { dispatchNextTask } from '../../dispatcher.js';
import { createRoutedTask } from '../../work-routing-store.js';
import {
  deferred,
  seedActiveF1,
  waitForBackendLock,
} from './helpers/take-map-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^take_map_authority_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `take_map_authority_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 5 });
  state.pool = testPool;
  await seedActiveF1(testPool);
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  state.pool = null;
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('Take → Map → Kernel authority on PostgreSQL', () => {
  it('database forbids a second scope from claiming the same repository', async () => {
    const client = await testPool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(
        `INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
         VALUES('cecelia-shadow','cecelia','legacy-ledger-v1','{}')`,
      )).rejects.toMatchObject({ code: '23505' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('database rejects a forged new-capability to hotfix receipt downgrade', async () => {
    const taskId = (await testPool.query(
      `INSERT INTO tasks(title,task_type,status,payload)
       VALUES($1,'harness_initiative','queued','{}'::jsonb)
       RETURNING id`,
      [`forged receipt ${randomUUID()}`],
    )).rows[0].id;
    const sourceId = `forged-profile-${randomUUID()}`;

    await expect(testPool.query(
      `INSERT INTO work_routing_receipts(
         task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,
         default_execution_profile,execution_profile_override,repo,map_scope,
         impact_contract_required,orchestrator,router_version,route_reason,evidence,
         map_scope_validation_version,direct_contract_seed
       ) VALUES(
         $1,'api',$2,'coding_mutation','new_capability','harness','harness_initiative',
         'new-capability-v1','hotfix-v1','cecelia','["F1"]'::jsonb,
         true,'kernel-harness-v2','work-router-v1','forged downgrade','{}'::jsonb,
         'active-business-node-v1',
         '{"contract_version":"direct-profile-contract-seed/v1","title":"forged","objective":"forged","execution_profile":"hotfix-v1"}'::jsonb
       )`,
      [taskId, sourceId],
    )).rejects.toMatchObject({
      code: '23514',
      constraint: 'work_routing_receipts_profile_shape_strength_check',
    });
  });

  it.each([
    ['missing change kind', null, 'hotfix-v1'],
    ['missing default profile', 'bugfix', null],
  ])('database rejects coding receipt profile shape: %s', async (
    label,
    changeKind,
    defaultProfile,
  ) => {
    const taskId = (await testPool.query(
      `INSERT INTO tasks(title,task_type,status,payload)
       VALUES($1,'harness_initiative','queued','{}'::jsonb)
       RETURNING id`,
      [`${label} ${randomUUID()}`],
    )).rows[0].id;

    await expect(testPool.query(
      `INSERT INTO work_routing_receipts(
         task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,
         default_execution_profile,execution_profile_override,repo,map_scope,
         impact_contract_required,orchestrator,router_version,route_reason,evidence,
         map_scope_validation_version,direct_contract_seed
       ) VALUES(
         $1,'api',$2,'coding_mutation',$3,'harness','harness_initiative',
         $4,NULL,'cecelia','["F1"]'::jsonb,
         true,'kernel-harness-v2','work-router-v1','forged shape','{}'::jsonb,
         'active-business-node-v1',$5::jsonb
       )`,
      [
        taskId,
        `forged-shape-${randomUUID()}`,
        changeKind,
        defaultProfile,
        defaultProfile === 'hotfix-v1'
          ? JSON.stringify({
            contract_version: 'direct-profile-contract-seed/v1',
            title: 'forged',
            objective: 'forged',
            execution_profile: 'hotfix-v1',
          })
          : null,
      ],
    )).rejects.toMatchObject({
      code: '23514',
      constraint: 'work_routing_receipts_profile_shape_strength_check',
    });
  });

  it('invalid repo scope fails before task/receipt persistence', async () => {
    const sourceId = `invalid-${randomUUID()}`;
    const title = `invalid repo scope ${sourceId}`;
    await expect(createRoutedTask(testPool, {
      source: 'api',
      source_id: sourceId,
      title,
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'cecelia',
      map_scope_hint: ['cecelia'],
      branch: 'cp-invalid-repo-scope',
      base_sha: 'a'.repeat(40),
    })).rejects.toThrow(/routing_map_scope_unresolved/);

    const partial = await testPool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tasks WHERE title=$2) AS tasks,
         (SELECT COUNT(*)::int FROM work_routing_receipts WHERE source_id=$1) AS receipts`,
      [sourceId, title],
    );
    expect(partial.rows[0]).toEqual({ tasks: 0, receipts: 0 });
  });

  it('valid F1 routes atomically, then no-runId false success releases claim and records failure', async () => {
    const sourceId = `valid-${randomUUID()}`;
    const created = await createRoutedTask(testPool, {
      source: 'api',
      source_id: sourceId,
      title: `kernel authority fixture ${sourceId}`,
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-valid-f1-scope',
      base_sha: 'b'.repeat(40),
      task: { priority: 'P0' },
    });
    state.taskId = created.task_id;
    state.trigger.mockResolvedValueOnce({ success: true, taskId: created.task_id });

    const result = await dispatchNextTask(null);

    expect(result).toMatchObject({
      dispatched: false,
      reason: 'executor_failed',
      task_id: created.task_id,
      error: 'kernel_authority_not_created',
    });
    const persisted = await testPool.query(
      `SELECT task.status,task.claimed_by,task.claimed_at,
              MAX(receipt.map_scope_validation_version) AS map_scope_validation_version,
              COUNT(receipt.id)::int AS receipts,
              COUNT(event.id) FILTER (WHERE event.event_type='failed_dispatch')::int AS failures
         FROM tasks task
         LEFT JOIN work_routing_receipts receipt ON receipt.task_id=task.id
         LEFT JOIN task_events event ON event.task_id=task.id
        WHERE task.id=$1
        GROUP BY task.id`,
      [created.task_id],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'queued',
      claimed_by: null,
      claimed_at: null,
      map_scope_validation_version: 'active-business-node-v1',
      receipts: 1,
      failures: 1,
    });
    expect(state.emit).not.toHaveBeenCalledWith('task_dispatched', expect.anything(), expect.anything());
  });

  it('terminal Kernel authority keeps terminal task and only clears the stale dispatcher claim', async () => {
    const sourceId = `terminal-${randomUUID()}`;
    const created = await createRoutedTask(testPool, {
      source: 'api',
      source_id: sourceId,
      title: `terminal authority fixture ${sourceId}`,
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-terminal-authority',
      base_sha: 'e'.repeat(40),
      task: { priority: 'P0' },
    });
    const runId = randomUUID();
    state.taskId = created.task_id;
    state.trigger.mockImplementationOnce(async () => {
      await testPool.query(
        `INSERT INTO initiative_runs(
           id,initiative_id,phase,current_task_id,orchestrator_version,created_source,
           record_trust_status,impact_contract_policy,impact_contract_policy_reason
         ) VALUES($1,$2,'failed',$3,'v2','kernel_dispatch','trusted',
           'legacy_exempt','terminal dispatcher reconciliation fixture')`,
        [runId, randomUUID(), created.task_id],
      );
      await testPool.query(
        `UPDATE tasks SET status='failed',error_message='authoritative failure',updated_at=NOW()
          WHERE id=$1`,
        [created.task_id],
      );
      return {
        success: false,
        taskId: created.task_id,
        runId,
        authorityExists: true,
        kernelAuthority: 'terminal',
        terminal: true,
        reason: 'kernel_terminal_authority',
      };
    });

    const result = await dispatchNextTask(null);

    expect(result).toMatchObject({
      dispatched: false,
      reason: 'kernel_terminal_authority',
      task_id: created.task_id,
      run_id: runId,
      terminal: true,
    });
    const persisted = await testPool.query(
      `SELECT task.status,task.claimed_by,task.claimed_at,
              COUNT(event.id) FILTER (WHERE event.event_type='failed_dispatch')::int AS failures
         FROM tasks task
         LEFT JOIN task_events event ON event.task_id=task.id
        WHERE task.id=$1
        GROUP BY task.id`,
      [created.task_id],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'failed',
      claimed_by: null,
      claimed_at: null,
      failures: 0,
    });
    expect(state.emit).not.toHaveBeenCalledWith('task_dispatched', expect.anything(), expect.anything());
  });

  it('holds the validated active projection through task and receipt commit', async () => {
    const oldProjection = (await testPool.query(
      `SELECT id,manifest_version_id,manifest_digest
         FROM map_projection_runs
        WHERE scope_key='cecelia' AND status='active'`,
    )).rows[0];
    const newProjectionId = randomUUID();
    await testPool.query(
      `INSERT INTO map_projection_runs(
         id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
         projector_version,projection_digest,status
       ) VALUES($1,'cecelia',$2,$3,'{}','test-v2',$4,'building')`,
      [
        newProjectionId,
        oldProjection.manifest_version_id,
        oldProjection.manifest_digest,
        randomUUID().replaceAll('-', '').repeat(2),
      ],
    );

    const clientA = await testPool.connect();
    const clientB = await testPool.connect();
    const validated = deferred();
    const releaseRoute = deferred();
    const events = [];
    const sourceId = `projection-race-${randomUUID()}`;
    const title = `projection race ${sourceId}`;
    const routeClient = {
      query: async (sql, args) => {
        const result = await clientA.query(sql, args);
        if (String(sql).includes('WITH authoritative_scope AS')) {
          events.push('validated');
          validated.resolve();
          await releaseRoute.promise;
        }
        if (String(sql).includes('INSERT INTO tasks')) events.push('task_inserted');
        if (sql === 'COMMIT') events.push('route_committed');
        return result;
      },
    };

    const route = createRoutedTask(routeClient, {
      source: 'api', source_id: sourceId, title,
      mutation_intent: 'write', declared_change_kind: 'bugfix',
      repo_hint: 'cecelia', map_scope_hint: ['F1'],
      branch: 'cp-projection-race', base_sha: 'c'.repeat(40),
    });
    try {
      await validated.promise;
      await clientB.query('BEGIN');
      const backendPid = (await clientB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const activation = (async () => {
        await clientB.query(
          `UPDATE map_projection_runs SET status='superseded'
            WHERE scope_key='cecelia' AND status='active' AND id<>$1`,
          [newProjectionId],
        );
        await clientB.query(
          `UPDATE map_projection_runs SET status='active',activated_at=NOW()
            WHERE id=$1 AND status='building'`,
          [newProjectionId],
        );
        await clientB.query('COMMIT');
        events.push('activation_committed');
      })();

      const activationWaited = await waitForBackendLock(testPool, backendPid, activation);
      releaseRoute.resolve();
      const created = await route;
      await activation;

      expect(activationWaited).toBe(true);
      expect(events).toEqual([
        'validated', 'task_inserted', 'route_committed', 'activation_committed',
      ]);
      expect(created.routing_receipt_id).toBeTruthy();

      const rejectedSourceId = `post-switch-${randomUUID()}`;
      const rejectedTitle = `post switch ${rejectedSourceId}`;
      await expect(createRoutedTask(testPool, {
        source: 'api', source_id: rejectedSourceId, title: rejectedTitle,
        mutation_intent: 'write', declared_change_kind: 'bugfix',
        repo_hint: 'cecelia', map_scope_hint: ['F1'],
        branch: 'cp-post-switch', base_sha: 'd'.repeat(40),
      })).rejects.toThrow(/routing_map_scope_unresolved/);
      const partial = await testPool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tasks WHERE title=$2) AS tasks,
           (SELECT COUNT(*)::int FROM work_routing_receipts WHERE source_id=$1) AS receipts`,
        [rejectedSourceId, rejectedTitle],
      );
      expect(partial.rows[0]).toEqual({ tasks: 0, receipts: 0 });
    } finally {
      releaseRoute.resolve();
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });
});
