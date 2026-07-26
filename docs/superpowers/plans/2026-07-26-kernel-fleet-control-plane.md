# Kernel Fleet Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the US M4 Kernel select a real local or remote execution transport and persist authenticated requested/actual machine evidence.

**Architecture:** Keep derive and workflow state on US M4. The Dispatcher passes the verified `ExecutionTarget` to an execution transport router; local attempts retain Docker, while xian attempts use an authenticated Bridge client. Launch receipts and terminal callbacks must carry a server-verifiable machine attestation before `actual_machine_id` becomes trusted.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, Vitest, existing Harness Kernel provider adapters and detached launcher.

---

## File map

- Create `packages/brain/migrations/363_kernel_fleet_execution_receipts.sql`: additive Attempt receipt fields.
- Create `packages/brain/src/orchestrator/execution-transport.js`: local/remote transport selection.
- Create `packages/brain/src/orchestrator/remote-bridge-transport.js`: authenticated Bridge HTTP client.
- Create `packages/brain/src/orchestrator/machine-attestation.js`: HMAC creation and verification.
- Modify `packages/brain/src/orchestrator/attempt-store.js`: persist requested target and verified launch receipt.
- Modify `packages/brain/src/orchestrator/dispatcher.js`: pass `ExecutionTarget` to transport.
- Modify `packages/brain/src/orchestrator/run.js`: production transport wiring.
- Modify `packages/brain/src/routes/harness-callback.js`: callback machine verification.
- Modify `packages/brain/src/orchestrator/attempt-telemetry.js`: expose execution evidence.
- Add focused tests next to every modified module.

### Task 1: Add execution receipt storage

**Files:**
- Create: `packages/brain/migrations/363_kernel_fleet_execution_receipts.sql`
- Create: `packages/brain/src/orchestrator/fleet-execution-migration.test.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`

- [ ] **Step 1: Write the failing migration and store tests**

```js
it('adds requested/actual machine and transport evidence', () => {
  for (const column of [
    'requested_machine_id',
    'actual_machine_id',
    'execution_transport',
    'remote_job_id',
    'machine_attestation_status',
    'lease_generation',
  ]) expect(sql).toContain(column);
});

it('records a launch receipt only while the lease owner still owns starting/running', async () => {
  await store.recordLaunchReceipt('attempt-1', {
    leaseOwner: 'kernel:1',
    actualMachineId: 'xian-mac-m4',
    executionTransport: 'remote-bridge',
    remoteJobId: 'job-1',
    attestationStatus: 'verified',
  });
  expect(query.mock.calls.at(-1)[0]).toMatch(/status IN \\('starting','running'\\)/);
  expect(query.mock.calls.at(-1)[0]).toMatch(/lease_owner = \\$2/);
});
```

- [ ] **Step 2: Run the tests and verify Red**

Run:

```bash
npx vitest run \
  src/orchestrator/fleet-execution-migration.test.js \
  src/orchestrator/__tests__/attempt-store.test.js
```

Expected: FAIL because migration 363 and `recordLaunchReceipt()` do not exist.

- [ ] **Step 3: Add the additive migration**

```sql
ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS requested_machine_id TEXT,
  ADD COLUMN IF NOT EXISTS actual_machine_id TEXT,
  ADD COLUMN IF NOT EXISTS execution_transport TEXT,
  ADD COLUMN IF NOT EXISTS remote_job_id TEXT,
  ADD COLUMN IF NOT EXISTS machine_attestation_status TEXT,
  ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0;

UPDATE harness_attempts
   SET requested_machine_id = COALESCE(requested_machine_id, machine_id)
 WHERE requested_machine_id IS NULL;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_transport_check
  CHECK (execution_transport IS NULL OR execution_transport IN ('local-docker','remote-bridge')),
  ADD CONSTRAINT harness_attempts_attestation_check
  CHECK (machine_attestation_status IS NULL
      OR machine_attestation_status IN ('local','verified','rejected','pending'));
```

Guard each constraint with this concrete pattern so the migration is rerunnable:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'harness_attempts_transport_check'
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_transport_check
      CHECK (execution_transport IS NULL
          OR execution_transport IN ('local-docker','remote-bridge'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'harness_attempts_attestation_check'
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_attestation_check
      CHECK (machine_attestation_status IS NULL
          OR machine_attestation_status IN ('local','verified','rejected','pending'));
  END IF;
END $$;
```

- [ ] **Step 4: Persist requested target and launch receipt**

Extend `createAttempt()` so `machine_id` and `requested_machine_id` receive the same verified target at creation. Add:

```js
async recordLaunchReceipt(id, {
  leaseOwner,
  actualMachineId,
  executionTransport,
  remoteJobId = null,
  attestationStatus,
}) {
  return firstRow(await pool.query(
    `UPDATE harness_attempts
        SET actual_machine_id=$3,
            execution_transport=$4,
            remote_job_id=$5,
            machine_attestation_status=$6,
            updated_at=NOW()
      WHERE id=$1
        AND lease_owner=$2
        AND status IN ('starting','running')
      RETURNING *`,
    [id, leaseOwner, actualMachineId, executionTransport, remoteJobId, attestationStatus],
  ));
}
```

Update `reclaim()` to increment `lease_generation = lease_generation + 1` in the same
fenced `UPDATE`. Fresh Attempts remain generation 0; a reclaimed remote Attempt can
therefore never collide with the previous Bridge job claim.

- [ ] **Step 5: Run Green and commit**

Run the Task 1 test command. Expected: both files PASS.

```bash
git add packages/brain/migrations/363_kernel_fleet_execution_receipts.sql \
  packages/brain/src/orchestrator/fleet-execution-migration.test.js \
  packages/brain/src/orchestrator/attempt-store.js \
  packages/brain/src/orchestrator/__tests__/attempt-store.test.js
git commit -m "feat(kernel): persist fleet execution receipts"
```

### Task 2: Freeze machine attestation and transport contracts

**Files:**
- Create: `packages/brain/src/orchestrator/machine-attestation.js`
- Create: `packages/brain/src/orchestrator/machine-attestation.test.js`
- Create: `packages/brain/src/orchestrator/execution-transport.js`
- Create: `packages/brain/src/orchestrator/execution-transport.test.js`

- [ ] **Step 1: Write Red tests**

```js
it('rejects an attestation copied to another attempt', () => {
  const signed = signMachineAttestation({
    secret: 'x'.repeat(32),
    attemptId: ATTEMPT_A,
    machineId: 'xian-mac-m4',
    jobId: 'job-1',
  });
  expect(verifyMachineAttestation({
    secret: 'x'.repeat(32),
    attemptId: ATTEMPT_B,
    machineId: 'xian-mac-m4',
    jobId: 'job-1',
    attestation: signed,
  })).toBe(false);
});

it('routes US to local and xian to remote without silent fallback', async () => {
  await router.launch({ attempt: usAttempt, target: { machine: 'us-mac-m4' } });
  await router.launch({ attempt: xianAttempt, target: { machine: 'xian-mac-m4' } });
  expect(local.launch).toHaveBeenCalledOnce();
  expect(remote.launch).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Verify Red**

Run:

```bash
npx vitest run \
  src/orchestrator/machine-attestation.test.js \
  src/orchestrator/execution-transport.test.js
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement HMAC attestation**

Use `createHmac('sha256', secret)` over this exact canonical string:

```js
`${attemptId}\n${machineId}\n${jobId}`
```

Require a secret of at least 32 characters, require a 64-character lowercase hex attestation, and compare decoded buffers with `timingSafeEqual`.

- [ ] **Step 4: Implement the transport router**

```js
export function createExecutionTransportRouter({ local, remote }) {
  return Object.freeze({
    async launch(input) {
      const machine = input.target?.machine;
      if (machine === 'us-mac-m4') {
        const launched = await local.launch(input);
        return {
          ...launched,
          actualMachineId: 'us-mac-m4',
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
        };
      }
      if (machine === 'xian-mac-m4' || machine === 'xian-mac-m1') {
        return remote.launch(input);
      }
      throw new Error(`execution_transport_unavailable:${String(machine)}`);
    },
  });
}
```

Do not add a catch that falls back to local. Fallback must create a new Attempt through Kernel reconciliation.

- [ ] **Step 5: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/machine-attestation.js \
  packages/brain/src/orchestrator/machine-attestation.test.js \
  packages/brain/src/orchestrator/execution-transport.js \
  packages/brain/src/orchestrator/execution-transport.test.js
git commit -m "feat(kernel): define authenticated fleet transports"
```

### Task 3: Add the remote Bridge client

**Files:**
- Create: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Create: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`

- [ ] **Step 1: Write Red contract tests**

Test that the client:

```js
expect(fetchFn).toHaveBeenCalledWith(
  'http://100.86.57.69:3458/harness/attempts',
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: 'Bearer bridge-secret',
      'Content-Type': 'application/json',
    }),
  }),
);
expect(result).toEqual({
  actualMachineId: 'xian-mac-m4',
  executionTransport: 'remote-bridge',
  remoteJobId: 'job-1',
  attestationStatus: 'verified',
});
```

Also test HTTP timeout, unknown machine, mismatched machine, invalid attestation, HTTP 409
duplicate response, authenticated `inspect()` and authenticated `cancel()`.

- [ ] **Step 2: Verify Red**

Run `npx vitest run src/orchestrator/remote-bridge-transport.test.js`.
Expected: FAIL with missing module.

- [ ] **Step 3: Implement the client**

The request body contains only:

```js
{
  attempt_id: attempt.id,
  run_id: attempt.run_id,
  lease_owner: attempt.lease_owner,
  lease_generation: attempt.lease_generation ?? 0,
  target,
  provider_spec: {
    provider: spec.provider,
    command: spec.command,
    args: spec.args,
    stdin: spec.stdin,
    output: spec.output,
  },
  callback_url: callbackUrl,
  callback_token: attempt.callbackSecret,
}
```

Resolve Bridge URLs from a frozen map injected by `run.js`; never build URLs from LLM or task artifacts. Require HTTP 202 and verify `actual_machine_id`, `job_id`, and attestation before returning a receipt.

Implement:

```js
inspect({ attempt, target }) // GET /harness/attempts/:attemptId
cancel({ attempt, target })  // POST /harness/attempts/:attemptId/cancel
```

Both methods must use the configured Bridge URL and Bearer credential. `cancel()` must
require the same lease owner and generation; a 404/409 is returned as a structured
failure and never causes a local fallback.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/remote-bridge-transport.js \
  packages/brain/src/orchestrator/remote-bridge-transport.test.js
git commit -m "feat(kernel): add authenticated remote bridge client"
```

### Task 4: Wire Dispatcher to the real transport

**Files:**
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `packages/brain/src/orchestrator/run.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`

- [ ] **Step 1: Write Red integration assertions**

```js
expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({
  target: { provider: 'codex', account: 'team3', machine: 'xian-mac-m4' },
}));
expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
  machineId: 'xian-mac-m4',
}));
expect(attemptStore.recordLaunchReceipt).toHaveBeenCalledWith(
  attemptId,
  expect.objectContaining({
    actualMachineId: 'xian-mac-m4',
    executionTransport: 'remote-bridge',
  }),
);
```

Add a negative assertion proving a failed remote launch does not invoke local Docker.
Add another assertion: if the remote Bridge accepts but `recordLaunchReceipt()` fails,
Dispatcher calls remote `cancel()` for the same Attempt and does not report launch success.

- [ ] **Step 2: Verify Red**

Run:

```bash
npx vitest run \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/preflight/production-wiring.test.js
```

Expected: FAIL because `target` is not forwarded and receipts are not stored.

- [ ] **Step 3: Implement the wiring**

Carry `selectedTarget` outside the preflight block, pass it to `launcher.launch()`, then persist the returned receipt with the same lease owner. In `run.js`, construct:

`launcher.launch()` has one frozen receipt shape for both transports:

```js
{
  actualMachineId,
  executionTransport,
  remoteJobId,
  attestationStatus,
  containerId, // local only
  jobId,       // remote only
}
```

```js
const localLauncher = createDetachedLauncher({
  spawnDetached,
  removeContainer,
  attemptStore,
});
const remoteLauncher = createRemoteBridgeTransport({
  enabled: env.KERNEL_FLEET_REMOTE_ENABLED === 'true',
  bridgeUrls: {
    'xian-mac-m4': env.XIAN_M4_KERNEL_BRIDGE_URL,
    'xian-mac-m1': env.XIAN_M1_KERNEL_BRIDGE_URL,
  },
  sharedSecret: env.KERNEL_FLEET_BRIDGE_TOKEN,
});
const launcher = createExecutionTransportRouter({
  local: localLauncher,
  remote: remoteLauncher,
});
```

If either xian URL or the shared secret is absent, that remote target must fail preflight/launch with `execution_transport_unavailable`; it must not fall back locally.
The same fail-closed result is required unless `KERNEL_FLEET_REMOTE_ENABLED=true`.
Add a production-wiring test proving the default is disabled.

If launch succeeds but receipt persistence fails, call
`launcher.cancel({ attempt, target: selectedTarget })`, mark the Attempt
`launch_receipt_persist_failed`, and throw. This closes the remote orphan window rather
than allowing an untracked Worker to continue.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/dispatcher.js \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/run.js \
  packages/brain/src/orchestrator/preflight/production-wiring.test.js
git commit -m "feat(kernel): route attempts through selected machine transport"
```

### Task 5: Make remote Attempt state part of Kernel ground truth

**Files:**
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`

- [ ] **Step 1: Write Red remote lifecycle tests**

Create DB fixtures for a remote Attempt and assert:

```js
expect(observed.inflight.attempts).toEqual([
  expect.objectContaining({ id: attemptId, status: 'running' }),
]);
expect(derive(observed)).toMatchObject({
  action: 'wait:running',
});
```

Then change the same Attempt to `failed`, `error_code='provider_exit'`, and assert that
the relevant role receives the same failure route as a failed local container. Also
prove a completed remote Attempt is not considered in-flight.

- [ ] **Step 2: Verify Red**

Run:

```bash
npx vitest run \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/derive.test.js
```

Expected: remote rows do not currently affect `inflight` or `lastAgentExit`.

- [ ] **Step 3: Materialize remote state from `harness_attempts`**

Query the latest Attempt rows for the run. Return:

```js
inflight: {
  containers,
  host_pids: hostPids,
  attempts: attemptRows.filter((row) => ['starting', 'running'].includes(row.status)),
}
```

For the latest spawn hop, derive `lastAgentExit` from the matching terminal Attempt when
no scoped Docker container exists:

```js
{
  code: ['failed', 'cancelled'].includes(attempt.status) ? 1 : 0,
  auth_failed: attempt.error_code === 'auth_failed',
  action: latestSpawn.action,
}
```

Update `derive()` in-flight detection to include `inflight.attempts.length`. Do not add
a second state table.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/ground-truth.js \
  packages/brain/src/orchestrator/derive.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/derive.test.js
git commit -m "fix(kernel): replay remote attempts as ground truth"
```

### Task 6: Add deterministic strict and non-strict target recovery

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js`
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.test.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

- [ ] **Step 1: Write Red recovery tests**

Use this frozen role assignment shape:

```js
{
  provider: 'codex',
  account: 'team3',
  machine: 'xian-mac-m4',
  strict_affinity: false,
  fallback_targets: [
    { provider: 'codex', account: 'team5', machine: 'xian-mac-m1' },
    { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
  ],
}
```

Assert:

1. strict affinity + failed xian M4 never probes/launches another machine;
2. non-strict + a terminal failed Attempt on xian M4 selects xian M1;
3. the replacement has a new Attempt ID and a later hop;
4. when xian M1 is also exhausted, US M4 is selected;
5. Claude never appears in fallback candidates;
6. all exhausted targets returns `infrastructure_blocked`.

- [ ] **Step 2: Verify Red**

Run:

```bash
npx vitest run \
  src/orchestrator/preflight/capability-gate.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/orchestrator/__tests__/dispatcher.test.js
```

Expected: machine fallback and failed-target replay assertions fail.

- [ ] **Step 3: Expose failed target evidence**

Add:

```js
async listFailedExecutionTargets(runId, role) {
  const result = await pool.query(
    `SELECT provider, account_id, requested_machine_id
       FROM harness_attempts
      WHERE run_id=$1 AND role=$2 AND status IN ('failed','cancelled')
      ORDER BY hop`,
    [runId, role],
  );
  return result.rows.map((row) => ({
    provider: row.provider,
    account: row.account_id,
    machine: row.requested_machine_id,
  }));
}
```

- [ ] **Step 4: Evaluate ordered machine candidates before Attempt creation**

The Dispatcher must build:

```js
const preferredTarget = {
  provider: roleAssignment.provider ?? adapter.name,
  account: roleAssignment.account ?? requestedAccount,
  machine: roleAssignment.machine ?? machineId,
};
const candidateTargets = roleAssignment.strict_affinity === true
  ? [preferredTarget]
  : [preferredTarget, ...(roleAssignment.fallback_targets ?? [])];
```

Pass candidates and failed targets to Capability Gate. Gate probes them in order and
returns the first verified, healthy, non-exhausted target. It must never invent a
Provider/account/machine tuple.

- [ ] **Step 5: Preserve new-Attempt semantics**

Do not retry inside a failed Attempt. The failed launch remains terminal. On the next
Kernel decision hop the same unmet role intent creates a fresh Attempt ID; the failed
target list causes Capability Gate to select the next candidate.

- [ ] **Step 6: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/preflight/capability-gate.js \
  packages/brain/src/orchestrator/preflight/capability-gate.test.js \
  packages/brain/src/orchestrator/attempt-store.js \
  packages/brain/src/orchestrator/__tests__/attempt-store.test.js \
  packages/brain/src/orchestrator/dispatcher.js \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js
git commit -m "feat(kernel): recover fleet attempts onto verified targets"
```

### Task 7: Verify terminal callbacks against the launch receipt

**Files:**
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: Write Red adversarial tests**

Cover:

1. verified xian callback succeeds;
2. `provider_metadata.machine_id` differs from requested/actual → HTTP 409;
3. copied/invalid attestation → HTTP 409;
4. local callback without remote attestation succeeds only when receipt is `local`;
5. duplicate verified callback remains idempotent.

- [ ] **Step 2: Verify Red**

Run `npx vitest run src/routes/__tests__/harness-attempt-callback.test.js`.
Expected: the mismatched-machine tests currently return 200.

- [ ] **Step 3: Add callback verification before terminal writes**

```js
const machineId = result.provider_metadata?.machine_id;
if (attempt.execution_transport === 'remote-bridge') {
  const valid = machineId === attempt.requested_machine_id
    && machineId === attempt.actual_machine_id
    && verifyMachineAttestation({
      secret: fleetSecret,
      attemptId,
      machineId,
      jobId: attempt.remote_job_id,
      attestation: result.provider_metadata?.machine_attestation,
    });
  if (!valid) return res.status(409).json({ ok: false, error: 'machine_attestation_mismatch' });
}
```

Read the shared secret from `req.app.get('kernelFleetBridgeToken')`; production `server.js` must set it from environment without logging it.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/src/routes/harness-callback.js \
  packages/brain/src/routes/__tests__/harness-attempt-callback.test.js \
  packages/brain/src/server.js
git commit -m "fix(kernel): reject unverified fleet callbacks"
```

### Task 8: Expose fleet evidence in telemetry

**Files:**
- Modify: `packages/brain/src/orchestrator/attempt-telemetry.js`
- Modify: `packages/brain/src/orchestrator/attempt-telemetry.test.js`

- [ ] **Step 1: Write Red telemetry assertion**

```js
expect(telemetry.attempts[0]).toMatchObject({
  requested_machine_id: 'xian-mac-m4',
  actual_machine_id: 'xian-mac-m4',
  execution_transport: 'remote-bridge',
  machine_attestation_status: 'verified',
});
```

- [ ] **Step 2: Verify Red**

Run `npx vitest run src/orchestrator/attempt-telemetry.test.js`.
Expected: fields are absent.

- [ ] **Step 3: Select and return the five receipt fields**

Add them to the existing query and response mapping. Do not create a second telemetry table or event ledger.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/src/orchestrator/attempt-telemetry.js \
  packages/brain/src/orchestrator/attempt-telemetry.test.js
git commit -m "feat(kernel): expose fleet execution evidence"
```

### Task 9: Full verification and handoff

**Files:**
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`

- [ ] **Step 1: Bump Brain 1.267.80 → 1.267.81 in all four locations**

Run `bash scripts/facts-check.sh` and `bash scripts/check-version-sync.sh`.
Expected: both exit 0.

- [ ] **Step 2: Run the focused regression pool**

```bash
npx vitest run \
  src/orchestrator/fleet-execution-migration.test.js \
  src/orchestrator/machine-attestation.test.js \
  src/orchestrator/execution-transport.test.js \
  src/orchestrator/remote-bridge-transport.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/preflight/production-wiring.test.js \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/preflight/capability-gate.test.js \
  src/routes/__tests__/harness-attempt-callback.test.js \
  src/orchestrator/attempt-telemetry.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Run real PostgreSQL migration/integration and DevGate**

Run:

```bash
cd packages/brain
TEST_DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia_test \
  DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia_test \
  node src/migrate.js
TEST_DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia_test \
  DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia_test \
  node src/migrate.js
TEST_DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia_test \
  npx --no-install vitest run \
    src/__tests__/integration/kernel-wiring.pg.integration.test.js \
    --reporter=verbose
cd ../..
bash scripts/devgate/devgate.sh
```

Expected: both migration runs exit 0, the Kernel PostgreSQL integration file passes,
and DevGate exits 0.

- [ ] **Step 4: Commit and stop before merge**

```bash
git add packages/brain/DEFINITION.md packages/brain/package.json package-lock.json .brain-versions
git commit -m "chore(brain): bump version for fleet transport"
```

Push the branch, open a non-draft PR, attach Red→Green evidence and CI rollup, and leave it unmerged for independent review.
