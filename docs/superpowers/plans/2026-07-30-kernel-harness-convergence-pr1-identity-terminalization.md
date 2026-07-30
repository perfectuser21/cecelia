# Kernel Harness PR1 Identity and Terminalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop duplicate Kernel run creation and guarantee that every Kernel run has a task/source identity and reaches terminal state atomically with its parent task.

**Architecture:** Introduce one focused `kernel-run-store.js` authority for active-run lookup, transactional creation, and transactional finalization. PostgreSQL migration 375 adds the insertion identity fence, task foreign key, and one-active-run unique index; the foreground route, Kernel dispatcher, liveness probe, and orphan guard consume the same authority instead of carrying different key semantics.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, Vitest, Supertest, existing Cecelia Brain migration runner and DevGate.

---

## File map

| File | Responsibility |
|---|---|
| `packages/brain/migrations/375_kernel_run_identity.sql` | Add `created_source`, reject future identity-less v2 inserts, add task FK, enforce one active run per task |
| `packages/brain/src/orchestrator/kernel-run-store.js` | Sole authority for exact active lookup, transactional create, terminal finalization, and terminal mismatch reconciliation |
| `packages/brain/src/routes/initiatives.js` | Expose canonical `POST /relay-runs`; keep legacy POST only as a strict adapter |
| `packages/brain/src/harness-skill-relay.js` | Use run store for Kernel create and launch-failure terminalization; stamp legacy sources |
| `packages/brain/src/lib/kernel-liveness.js` | Use the same `current_task_id` active-run lookup with no initiative fallback |
| `packages/brain/src/lib/harness-orphan-guard.js` | Reconcile linked terminal runs; never requeue a Kernel task because no active run exists |
| `packages/brain/scripts/kernel-run-identity-preflight.mjs` | Read-only production conflict and identity report used before migration/deploy |
| `packages/brain/DEFINITION.md` and version files | Declare the new identity and terminalization contract |

No PR2 exact PATCH/GET, trust reconstruction, PR3 callback convergence, or PR4 production repair is included here.

---

### Task 1: Add the migration contract and real PostgreSQL Red tests

**Files:**

- Create: `packages/brain/src/__tests__/migration-375-kernel-run-identity.test.js`
- Create: `packages/brain/src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js`
- Create after Red: `packages/brain/migrations/375_kernel_run_identity.sql`

- [ ] **Step 1: Write the source contract test**

```js
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);

describe('migration 375 Kernel run identity', () => {
  it('adds the source, task identity fence, FK, and active-run uniqueness', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS created_source TEXT/);
    expect(sql).toMatch(/kernel_dispatch/);
    expect(sql).toMatch(/foreground_handoff/);
    expect(sql).toMatch(/legacy_relay/);
    expect(sql).toMatch(/REFERENCES tasks\s*\(id\)[\s\S]+NOT VALID/i);
    expect(sql).toMatch(/BEFORE INSERT ON initiative_runs/);
    expect(sql).toMatch(/current_task_id IS NULL OR NEW\.created_source IS NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]+current_task_id[\s\S]+phase NOT IN \('done', 'failed'\)/i);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
```

- [ ] **Step 2: Run the source contract test and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/migration-375-kernel-run-identity.test.js
```

Expected: FAIL because `375_kernel_run_identity.sql` does not exist.

- [ ] **Step 3: Write the PostgreSQL integration test**

The test must run in one transaction against `cecelia_test`, apply the real migration, and prove:

```js
it('rejects identity-less new v2 rows', async () => {
  await expectConstraintFailure(() => client.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, orchestrator_version)
     VALUES ($1, 'planning', 'v2')`,
    [initiativeId],
  ));
});

it('rejects two active v2 runs for one task but permits terminal history', async () => {
  await insertRun({ phase: 'planning', source: 'kernel_dispatch' });
  await expectConstraintFailure(() => insertRun({
    phase: 'generate',
    source: 'foreground_handoff',
  }));
  await client.query(
    `UPDATE initiative_runs
        SET phase='failed', completed_at=NOW()
      WHERE current_task_id=$1 AND phase='planning'`,
    [taskId],
  );
  await expect(insertRun({
    phase: 'planning',
    source: 'explicit_recovery',
  })).resolves.toMatchObject({ rowCount: 1 });
});

it('preserves an old NULL-identity row while rejecting new ones', async () => {
  expect(historicalNullRunStillExists).toBe(true);
});
```

Create the fixture row before applying the migration so the test covers the production compatibility case.

- [ ] **Step 4: Run the integration test and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js
```

Expected: FAIL because the migration is absent.

- [ ] **Step 5: Implement migration 375**

Create:

```sql
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS created_source TEXT;

ALTER TABLE initiative_runs
  DROP CONSTRAINT IF EXISTS initiative_runs_created_source_check;
ALTER TABLE initiative_runs
  ADD CONSTRAINT initiative_runs_created_source_check
  CHECK (
    created_source IS NULL
    OR created_source IN (
      'kernel_dispatch',
      'foreground_handoff',
      'legacy_relay',
      'explicit_recovery',
      'historical_reconstruction'
    )
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='initiative_runs_current_task_fk'
       AND conrelid='initiative_runs'::regclass
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_current_task_fk
      FOREIGN KEY (current_task_id) REFERENCES tasks(id) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_v2_run_insert_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.orchestrator_version='v2'
     AND (NEW.current_task_id IS NULL OR NEW.created_source IS NULL) THEN
    RAISE EXCEPTION 'v2 initiative run requires current_task_id and created_source'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_v2_run_insert_identity ON initiative_runs;
CREATE TRIGGER trg_enforce_v2_run_insert_identity
BEFORE INSERT ON initiative_runs
FOR EACH ROW EXECUTE FUNCTION enforce_v2_run_insert_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_initiative_runs_active_task_v2
  ON initiative_runs(current_task_id)
  WHERE orchestrator_version='v2'
    AND current_task_id IS NOT NULL
    AND phase NOT IN ('done', 'failed');
```

Do not add a manual `schema_version` insert; migration 310+ is registered by the runner.

- [ ] **Step 6: Run both tests and verify Green**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-375-kernel-run-identity.test.js \
  src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js
```

Expected: both files PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/brain/migrations/375_kernel_run_identity.sql \
  packages/brain/src/__tests__/migration-375-kernel-run-identity.test.js \
  packages/brain/src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js
git commit -m "test(kernel): lock run identity schema"
```

---

### Task 2: Create the Kernel run authority with transactional creation

**Files:**

- Create: `packages/brain/src/orchestrator/kernel-run-store.js`
- Create: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`

- [ ] **Step 1: Write the failing create tests**

Use a transaction-capable fake client that records `BEGIN`, `SELECT ... FOR UPDATE`,
active lookup, INSERT, `COMMIT`, and `release`.

```js
it('creates a fully identified Kernel run under a task lock', async () => {
  const result = await createKernelRun(pool, {
    taskId: TASK_ID,
    initiativeId: INITIATIVE_ID,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
  });

  expect(result).toMatchObject({ created: true, run: { id: RUN_ID } });
  expect(sqlText).toContain('FOR UPDATE');
  expect(insertSql).toContain('current_task_id');
  expect(insertSql).toContain('created_source');
  expect(queryOrder).toEqual([
    'BEGIN', 'task-lock', 'active-run', 'insert-run', 'COMMIT', 'release',
  ]);
});

it('returns the existing active run without inserting', async () => {
  const result = await createKernelRun(pool, validInput);
  expect(result).toMatchObject({ created: false, run: { id: RUN_ID } });
  expect(queryOrder).not.toContain('insert-run');
});

it('rolls back when task identity or state is invalid', async () => {
  await expect(createKernelRun(pool, validInput))
    .rejects.toThrow(/kernel run task .* not eligible/);
  expect(queryOrder).toEqual(['BEGIN', 'task-lock', 'ROLLBACK', 'release']);
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js
```

Expected: FAIL because `kernel-run-store.js` does not exist.

- [ ] **Step 3: Implement exact active lookup and create**

Export:

```js
export async function loadActiveKernelRun(db, taskId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, initiative_id, current_task_id, phase, orchestrator_heartbeat_at,
            orchestrator_pid, orchestrator_host, started_at, created_source
       FROM initiative_runs
      WHERE current_task_id=$1
        AND orchestrator_version='v2'
        AND phase NOT IN ('done','failed')
      ORDER BY started_at DESC, id DESC
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [taskId],
  );
  return rows[0] ?? null;
}

export async function createKernelRun(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = (await client.query(
      `SELECT id, task_type, status, payload
         FROM tasks WHERE id=$1 FOR UPDATE`,
      [input.taskId],
    )).rows[0];
    if (!task || task.task_type !== 'harness_initiative'
        || ['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new Error(`kernel run task ${input.taskId} not eligible`);
    }
    const active = await loadActiveKernelRun(client, input.taskId, { forUpdate: true });
    if (active) {
      await client.query('COMMIT');
      return { created: false, run: active };
    }
    const run = (await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, phase, journey_id, orchestrator_version,
         orchestrator_host, deadline_at, ability_id, current_task_id,
         created_source
       ) VALUES (
         $1,$2,$3,'v2',$4,NOW()+($5*INTERVAL '1 hour'),$6,$7,$8
       ) RETURNING *`,
      [
        input.initiativeId, input.phase, input.journeyId, input.host,
        input.deadlineHours, input.abilityId, input.taskId, input.createdSource,
      ],
    )).rows[0];
    await client.query('COMMIT');
    return { created: true, run };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Validate `createdSource` against the migration enum and phase against the existing Kernel
phase enum before opening the transaction.

- [ ] **Step 4: Run and verify Green**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js
```

Expected: all creation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/orchestrator/kernel-run-store.js \
  packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js
git commit -m "feat(kernel): add transactional run authority"
```

---

### Task 3: Add atomic run/task terminalization

**Files:**

- Modify: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/kernel-handlers.js`

- [ ] **Step 1: Write terminalization Red tests**

```js
it('fails run and parent task in one transaction', async () => {
  const result = await finalizeKernelRun(pool, {
    runId: RUN_ID,
    expectedTaskId: TASK_ID,
    outcome: 'failed',
    reason: 'automation_deadline_exceeded',
  });
  expect(result).toMatchObject({ changed: true, outcome: 'failed' });
  expect(runUpdateSql).toMatch(/phase='failed'[\s\S]+completed_at/);
  expect(taskUpdateSql).toMatch(/status='failed'[\s\S]+completed_at/);
  expect(terminalEventSql).toMatch(/effect:run_terminal/);
  expect(queryOrder.at(-2)).toBe('COMMIT');
});

it('rolls back the run when the task write fails', async () => {
  await expect(finalizeKernelRun(pool, failedInput)).rejects.toThrow('task write failed');
  expect(queryOrder).toContain('ROLLBACK');
  expect(queryOrder).not.toContain('COMMIT');
});

it('does not overwrite an existing conflicting terminal outcome', async () => {
  await expect(finalizeKernelRun(pool, {
    ...failedInput,
    outcome: 'done',
  })).rejects.toThrow(/terminal outcome conflict/);
});

it('is idempotent for the same terminal outcome', async () => {
  const result = await finalizeKernelRun(pool, failedInput);
  expect(result).toMatchObject({ changed: false, outcome: 'failed' });
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js
```

Expected: FAIL because `finalizeKernelRun` is not exported.

- [ ] **Step 3: Implement terminalization**

Add:

```js
export async function finalizeKernelRun(pool, {
  runId,
  expectedTaskId,
  outcome,
  reason = null,
}) {
  if (!['done', 'failed'].includes(outcome)) {
    throw new Error(`invalid Kernel terminal outcome: ${outcome}`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = (await client.query(
      `SELECT id,current_task_id,phase FROM initiative_runs
        WHERE id=$1 AND orchestrator_version='v2' FOR UPDATE`,
      [runId],
    )).rows[0];
    if (!run || run.current_task_id !== expectedTaskId) {
      throw new Error(`Kernel run/task identity mismatch: ${runId}/${expectedTaskId}`);
    }
    if (['done', 'failed'].includes(run.phase) && run.phase !== outcome) {
      throw new Error(`Kernel terminal outcome conflict: ${run.phase}/${outcome}`);
    }
    const changed = !['done', 'failed'].includes(run.phase);
    if (changed) {
      await client.query(
        `UPDATE initiative_runs
            SET phase=$2, failure_reason=CASE WHEN $2='failed' THEN $3 ELSE failure_reason END,
                completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
          WHERE id=$1`,
        [runId, outcome, reason],
      );
    }
    const taskStatus = outcome === 'done' ? 'completed' : 'failed';
    await client.query(
      `UPDATE tasks
          SET status=$2,
              error_message=CASE WHEN $2='failed' THEN $3 ELSE error_message END,
              completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
        WHERE id=$1 AND status NOT IN ('completed','failed','cancelled')`,
      [expectedTaskId, taskStatus, reason],
    );
    if (changed) {
      await client.query(
        `INSERT INTO orchestrator_decision_log
           (run_id,hop,observed,derived_phase,gate_verdict,action,detail)
         SELECT $1,COALESCE(MAX(hop),0)+1,'{}'::jsonb,$2,$3,
                'effect:run_terminal',$4::jsonb
           FROM orchestrator_decision_log
          WHERE run_id=$1`,
        [
          runId,
          outcome,
          outcome === 'done' ? 'allow' : 'deny:run_failed',
          JSON.stringify({ task_id: expectedTaskId, outcome, reason }),
        ],
      );
    }
    await client.query('COMMIT');
    return { changed, outcome, runId, taskId: expectedTaskId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

PR1 writes the run terminal event in the same transaction as run/task terminalization.
PR3 separately makes callback attempt terminalization and its callback decision event atomic;
it must not create a second `effect:run_terminal` event.

- [ ] **Step 4: Replace loop and report direct updates**

Inject or import `finalizeKernelRun` in `loop.js` and replace every
`markRunFailed(pool, runId, reason)` call with:

```js
await finalizeKernelRun(deps.pool, {
  runId: resolvedRunId,
  expectedTaskId: taskId,
  outcome: 'failed',
  reason,
});
```

In `kernel-handlers.js` report path, replace the local transaction that updates run/task
with:

```js
await finalizeKernelRun(deps.pool, {
  runId: ctx.runId,
  expectedTaskId: ctx.taskId,
  outcome: 'done',
});
```

Keep `markRunPaused` separate because paused is nonterminal.

- [ ] **Step 5: Run focused tests and verify Green**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js
```

Expected: all PASS; loop failure assertions include task terminalization.

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/orchestrator/kernel-run-store.js \
  packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js \
  packages/brain/src/orchestrator/loop.js \
  packages/brain/src/orchestrator/kernel-handlers.js \
  packages/brain/src/orchestrator/__tests__/loop.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js
git commit -m "fix(kernel): terminalize run and task atomically"
```

---

### Task 4: Wire canonical and legacy foreground create routes

**Files:**

- Modify: `packages/brain/src/routes/initiatives.js`
- Modify: `packages/brain/src/__tests__/relay-runs-create.test.js`
- Create: `packages/brain/src/__tests__/relay-runs-canonical-create.test.js`

- [ ] **Step 1: Write canonical route Red tests**

```js
it('requires initiative_id, current_task_id, and created_source', async () => {
  for (const body of [
    {},
    { initiative_id: INITIATIVE_ID },
    { initiative_id: INITIATIVE_ID, current_task_id: TASK_ID },
  ]) {
    await request(app).post('/api/brain/orchestrator/relay-runs')
      .send(body).expect(400);
  }
});

it('returns the authoritative run id from transactional create', async () => {
  const response = await request(app)
    .post('/api/brain/orchestrator/relay-runs')
    .send({
      initiative_id: INITIATIVE_ID,
      current_task_id: TASK_ID,
      created_source: 'foreground_handoff',
      phase: 'planning',
    })
    .expect(201);
  expect(response.body).toMatchObject({
    created: true,
    run: { id: RUN_ID, current_task_id: TASK_ID },
  });
});

it('makes the legacy route a strict identified adapter', async () => {
  await request(app)
    .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
    .send({})
    .expect(400);
  await request(app)
    .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
    .send({
      current_task_id: TASK_ID,
      created_source: 'foreground_handoff',
    })
    .expect(201);
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/relay-runs-create.test.js \
  src/__tests__/relay-runs-canonical-create.test.js
```

Expected: canonical POST returns 404 or legacy route still accepts an empty body.

- [ ] **Step 3: Implement the shared route adapter**

Add one handler:

```js
async function createRelayRun(req, res, legacyInitiativeId = null) {
  const body = req.body ?? {};
  const initiativeId = legacyInitiativeId ?? body.initiative_id;
  const taskId = body.current_task_id;
  const source = body.created_source;
  if (!UUID_RE.test(initiativeId ?? '')
      || !UUID_RE.test(taskId ?? '')
      || !source) {
    return res.status(400).json({
      error: 'initiative_id, current_task_id and created_source are required',
    });
  }
  try {
    const result = await createKernelRun(pool, {
      taskId,
      initiativeId,
      phase: body.phase ?? 'planning',
      journeyId: body.journey_id ?? null,
      abilityId: null,
      host: 'foreground',
      deadlineHours: 6,
      createdSource: source,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return res.status(error.message.includes('not eligible') ? 409 : 500)
      .json({ error: error.message.includes('not eligible') ? error.message : 'internal error' });
  }
}

router.post('/relay-runs', (req, res) => createRelayRun(req, res));
router.post('/relay-runs/:initiative_id', (req, res) => (
  createRelayRun(req, res, req.params.initiative_id)
));
```

Register the no-parameter POST before `/:initiative_id`.

- [ ] **Step 4: Run and verify Green**

Run the command from Step 2. Expected: all route tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/initiatives.js \
  packages/brain/src/__tests__/relay-runs-create.test.js \
  packages/brain/src/__tests__/relay-runs-canonical-create.test.js
git commit -m "fix(kernel): require identity for foreground runs"
```

---

### Task 5: Use one identity query in spawn and liveness

**Files:**

- Modify: `packages/brain/src/harness-skill-relay.js`
- Modify: `packages/brain/src/lib/kernel-liveness.js`
- Modify: `packages/brain/src/__tests__/harness-skill-relay.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-liveness.test.js`

- [ ] **Step 1: Write Red tests**

```js
it('stamps every v2 initiative run insert with created_source', async () => {
  await spawnSkillRelaySession(TASK, deps);
  for (const [sql, params] of deps.pool.query.mock.calls
    .filter(([sql]) => /INSERT INTO initiative_runs/.test(sql))) {
    expect(sql).toMatch(/created_source/);
    expect(params).toContain('legacy_relay');
  }
});

it('uses kernel_dispatch for Kernel runtime creation', async () => {
  await spawnSkillRelaySession(KERNEL_TASK, deps);
  expect(deps.createKernelRun).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      taskId: KERNEL_TASK.id,
      createdSource: 'kernel_dispatch',
    }),
  );
});

it('does not use initiative_id as a liveness identity fallback', async () => {
  await loadKernelRun(pool, { taskId: TASK_ID, initiativeId: INITIATIVE_ID });
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain('current_task_id = $1');
  expect(sql).not.toContain('OR initiative_id');
  expect(params).toEqual([TASK_ID]);
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/harness-skill-relay.test.js \
  src/lib/__tests__/kernel-liveness.test.js
```

Expected: source assertions and no-fallback liveness assertion FAIL.

- [ ] **Step 3: Wire the run store**

In `_spawnKernelRuntime`, call:

```js
const created = await createKernelRun(dbPool, {
  taskId: task.id,
  initiativeId,
  phase: 'planning',
  journeyId: task.payload?.journey_id ?? null,
  abilityId: task.ability_id ?? task.payload?.ability_id ?? null,
  host: 'kernel-v1',
  deadlineHours: 8,
  createdSource: 'kernel_dispatch',
});
if (!created.created) {
  return {
    ok: false,
    mode: 'kernel-v1',
    deferred: true,
    reason: 'kernel_run_exists',
    runId: created.run.id,
  };
}
```

On launch failure:

```js
await finalizeKernelRun(dbPool, {
  runId,
  expectedTaskId: task.id,
  outcome: 'failed',
  reason: `kernel_launch_failed:${error.message}`,
});
```

Do not write the task back to queued.

Add `created_source` to every remaining v2 INSERT in the file using `legacy_relay`.

Change `loadKernelRun` to delegate to `loadActiveKernelRun(pool, taskId)` and remove the
initiative fallback from query and JSDoc.

- [ ] **Step 4: Run and verify Green**

Run the command from Step 2. Expected: both test files PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-skill-relay.js \
  packages/brain/src/lib/kernel-liveness.js \
  packages/brain/src/__tests__/harness-skill-relay.test.js \
  packages/brain/src/lib/__tests__/kernel-liveness.test.js
git commit -m "fix(kernel): unify spawn and liveness identity"
```

---

### Task 6: Prevent orphan recovery from reviving terminal Kernel work

**Files:**

- Modify: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`
- Modify: `packages/brain/src/lib/harness-orphan-guard.js`
- Modify: `packages/brain/src/lib/__tests__/harness-orphan-guard.test.js`

- [ ] **Step 1: Write mismatch reconciliation Red tests**

```js
it('reconciles a linked failed run into its in-progress task', async () => {
  const result = await reconcileKernelTaskTerminal(pool, TASK_ID);
  expect(result).toMatchObject({
    reconciled: true,
    runId: RUN_ID,
    outcome: 'failed',
  });
  expect(taskUpdateSql).toMatch(/status='failed'/);
});

it('does not guess from initiative_id when no task-linked run exists', async () => {
  const result = await reconcileKernelTaskTerminal(pool, TASK_ID);
  expect(result).toEqual({ reconciled: false, reason: 'no_task_linked_terminal_run' });
  expect(pool.query.mock.calls.some(([sql]) => /initiative_id/.test(sql))).toBe(false);
});

it('does not requeue a Kernel task when liveness says no_kernel_run', async () => {
  const result = await sweepOrphanHarnessTasks({
    pool,
    execFn,
    assessKernel: async () => ({ verdict: 'unknown', reason: 'no_kernel_run' }),
    reconcileKernelTerminal: async () => ({
      reconciled: true,
      outcome: 'failed',
      runId: RUN_ID,
    }),
  });
  expect(result).toMatchObject({ requeued: 0, terminalReconciled: 1 });
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/lib/__tests__/harness-orphan-guard.test.js
```

Expected: reconciliation export/result counter does not exist.

- [ ] **Step 3: Implement exact terminal reconciliation**

Add:

```js
export async function reconcileKernelTaskTerminal(pool, taskId) {
  const { rows } = await pool.query(
    `SELECT id,phase
       FROM initiative_runs
      WHERE current_task_id=$1
        AND orchestrator_version='v2'
        AND phase IN ('done','failed')
      ORDER BY completed_at DESC NULLS LAST, started_at DESC, id DESC
      LIMIT 1`,
    [taskId],
  );
  const run = rows[0];
  if (!run) {
    return { reconciled: false, reason: 'no_task_linked_terminal_run' };
  }
  return finalizeKernelRun(pool, {
    runId: run.id,
    expectedTaskId: taskId,
    outcome: run.phase,
    reason: run.phase === 'failed' ? 'terminal_run_reconciliation' : null,
  }).then(() => ({
    reconciled: true,
    runId: run.id,
    outcome: run.phase,
  }));
}
```

For Kernel tasks, make orphan guard call this reconciliation before considering any
legacy requeue. `alive/dead/unknown/no_kernel_run` never falls through to
`requeueOrphanTask` for Kernel runtime. A dead active Kernel run is terminalized by
`finalizeKernelRun`; an identity-less historical run is left for PR4 and emits a warning.

Add `terminalReconciled` and `kernelUnresolved` counters to the sweep result.

- [ ] **Step 4: Run and verify Green**

Run the command from Step 2. Expected: all PASS and legacy relay requeue tests remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/orchestrator/kernel-run-store.js \
  packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js \
  packages/brain/src/lib/harness-orphan-guard.js \
  packages/brain/src/lib/__tests__/harness-orphan-guard.test.js
git commit -m "fix(kernel): stop orphan task resurrection"
```

---

### Task 7: Add the production preflight

**Files:**

- Create: `packages/brain/scripts/kernel-run-identity-preflight.mjs`
- Create: `packages/brain/src/__tests__/kernel-run-identity-preflight.test.js`

- [ ] **Step 1: Write Red tests for report classification**

Extract a pure function `classifyKernelRunIdentity(rows)` and test:

```js
it('blocks deploy for duplicate active task-linked runs', () => {
  expect(classifyKernelRunIdentity([
    { current_task_id: TASK_ID, active_count: 2 },
  ])).toMatchObject({ ok: false, duplicateActiveTasks: [TASK_ID] });
});

it('reports historical NULL identities without guessing them', () => {
  expect(classifyKernelRunIdentity([], [
    { id: RUN_ID, current_task_id: null, created_source: null },
  ])).toMatchObject({
    ok: true,
    historicalUntrustedRunIds: [RUN_ID],
  });
});
```

- [ ] **Step 2: Run and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/kernel-run-identity-preflight.test.js
```

Expected: FAIL because script/export does not exist.

- [ ] **Step 3: Implement the read-only CLI**

Queries:

```sql
SELECT current_task_id, COUNT(*)::int AS active_count, array_agg(id) AS run_ids
FROM initiative_runs
WHERE orchestrator_version='v2'
  AND current_task_id IS NOT NULL
  AND phase NOT IN ('done','failed')
GROUP BY current_task_id
HAVING COUNT(*) > 1;
```

```sql
SELECT id,initiative_id,current_task_id,phase,created_source,started_at,completed_at
FROM initiative_runs
WHERE orchestrator_version='v2'
  AND (current_task_id IS NULL OR created_source IS NULL)
ORDER BY started_at,id;
```

Print stable JSON. Exit `2` for duplicate active tasks, `0` when only historical
untrusted rows exist, and never mutate the database.

- [ ] **Step 4: Run unit test and a read-only local invocation**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/kernel-run-identity-preflight.test.js
node scripts/kernel-run-identity-preflight.mjs
```

Expected: test PASS; CLI prints JSON and performs no UPDATE/INSERT/DELETE.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/kernel-run-identity-preflight.mjs \
  packages/brain/src/__tests__/kernel-run-identity-preflight.test.js
git commit -m "feat(kernel): add run identity deploy preflight"
```

---

### Task 8: Version, definition, regression, and PR1 handoff

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `.brain-versions`
- Modify: `docs/superpowers/plans/2026-07-30-kernel-harness-convergence-pr1-identity-terminalization.md`

- [ ] **Step 1: Bump Brain patch version**

Run:

```bash
cd packages/brain
npm version patch --no-git-tag-version
```

Then append the exact new version to root `.brain-versions` and update the first version
line in `packages/brain/DEFINITION.md`.

- [ ] **Step 2: Document the shipped contract**

Add a top `DEFINITION.md` section containing:

```markdown
## Kernel run identity and atomic terminalization

- Every new v2 run is task-linked and source-stamped; PostgreSQL rejects identity-less inserts.
- One task can own at most one nonterminal v2 run.
- Kernel run completion/failure and parent task terminalization commit atomically.
- Kernel orphan reconciliation never revives a terminal task; unresolved historical NULL
  identities remain untouched for the trust-reconstruction phase.
- Rollback keeps migration 375 additive and returns the application to the previous image;
  it must never re-enable initiative-wide mutation.
```

- [ ] **Step 3: Run focused regression**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-375-kernel-run-identity.test.js \
  src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/__tests__/relay-runs-create.test.js \
  src/__tests__/relay-runs-canonical-create.test.js \
  src/__tests__/harness-skill-relay.test.js \
  src/lib/__tests__/kernel-liveness.test.js \
  src/lib/__tests__/harness-orphan-guard.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js
```

Expected: all test files and tests PASS.

- [ ] **Step 4: Run repository gates**

```bash
bash scripts/check-version-sync.sh
BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
bash scripts/local-precheck.sh
```

Run the three repository Brain DevGate commands in their mandatory order:

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

Expected: every command exits 0.

- [ ] **Step 5: Review the PR1 boundary**

Run:

```bash
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
git log --oneline origin/main..HEAD
```

Verify no exact-run PATCH/GET, trust apply, callback convergence, model policy, synthetic
canary, or unrelated GP/Fleet feature entered the branch.

- [ ] **Step 6: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json \
  packages/brain/DEFINITION.md .brain-versions \
  docs/superpowers/plans/2026-07-30-kernel-harness-convergence-pr1-identity-terminalization.md
git commit -m "docs(brain): define Kernel run ownership contract"
```

- [ ] **Step 7: Request independent review and publish the PR**

Push only the feature branch and open the PR:

```bash
git push -u origin cp-0730-kernel-run-identity-terminalization
gh pr create \
  --base main \
  --head cp-0730-kernel-run-identity-terminalization \
  --title "fix(kernel): enforce run identity and terminalization" \
  --body "Implements PR1 of the approved Kernel Harness convergence repair: task-linked source-stamped runs, one active run per task, atomic run/task terminalization, unified liveness identity, and no Kernel orphan resurrection. Excludes exact PATCH migration, callback convergence, and historical apply."
gh pr checks --watch --fail-fast
```

Fix any failure by adding a reproducing Red test first, rerun the failed check and the focused
regression pool, request independent review, and squash merge only after fresh required-check
verification. Never use `--admin`.

After merge, create a new independent worktree from the then-latest `origin/main` for PR2.
