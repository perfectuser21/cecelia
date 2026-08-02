# Kernel Fleet Two-Phase Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure no Fleet Runner starts before Brain durably records its attested launch receipt, and converge expired attempts whose Worker state is missing.

**Architecture:** Split the Fleet launch lifecycle into authenticated `prepare` and lease-fenced `start` operations. Dispatcher records the prepare receipt between those calls. Add an exact-attempt expired-lease reconciler so a missing Worker job becomes an infrastructure terminal result instead of a permanent `running` row.

**Tech Stack:** Node.js ESM/CJS, Express-style HTTP server, PostgreSQL, Vitest, Docker/OrbStack, LaunchDaemon Fleet Worker

---

## File map

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`: stopped-container preparation, durable Worker state, idempotent start.
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`: authenticated `/prepare` and `/:id/start` protocol routes.
- `packages/brain/src/orchestrator/remote-bridge-transport.js`: prepare/start HTTP client and attestation validation.
- `packages/brain/src/orchestrator/production-transport.js`: guarded prepare/start production interface.
- `packages/brain/src/orchestrator/dispatcher.js`: enforce prepare → receipt commit → start order.
- `packages/brain/src/orchestrator/expired-attempt-reconciler.js`: exact-attempt lease-expiry recovery policy.
- `packages/brain/src/orchestrator/loop.js`: invoke reconciliation before treating an attempt as live.
- Adjacent tests: prove ordering, fencing, idempotency, cleanup, and convergence.
- `packages/brain/package.json`, `package-lock.json`, `packages/brain/DEFINITION.md`: version and definition synchronization.

### Task 1: Red tests for Worker prepare/start lifecycle

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`

- [ ] **Step 1: Add an attempt-runner Red test proving prepare does not start the container**

Add a test that invokes `runner.prepare(request())`, then asserts:

```js
expect(deps.docker.prepare).toHaveBeenCalledOnce();
expect(deps.docker.start).not.toHaveBeenCalled();
expect(stateStore.states.get(ATTEMPT_ID)).toMatchObject({
  attempt_id: ATTEMPT_ID,
  status: 'prepared',
  lease_owner: 'dispatcher-1',
  lease_generation: 0,
});
```

- [ ] **Step 2: Add Red tests for idempotent start and lease fencing**

```js
await expect(runner.start(ATTEMPT_ID, {
  owner: 'dispatcher-1', generation: 0,
})).resolves.toMatchObject({ status: 'running', attempt_id: ATTEMPT_ID });
await expect(runner.start(ATTEMPT_ID, {
  owner: 'dispatcher-1', generation: 0,
})).resolves.toMatchObject({ status: 'running', deduped: true });
await expect(runner.start(ATTEMPT_ID, {
  owner: 'stale-owner', generation: 0,
})).rejects.toThrow('attempt_lease_conflict');
```

- [ ] **Step 3: Add HTTP contract Red tests**

Assert `POST /harness/attempts/prepare` returns the attested `202` receipt without calling start, and `POST /harness/attempts/:id/start` requires the bearer token plus matching lease.

- [ ] **Step 4: Run the Red tests**

Run:

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs scripts/fleet-worker/fleet-worker.test.js
```

Expected: FAIL because `prepare`, `start`, and the new routes do not exist.

- [ ] **Step 5: Commit the Red tests**

```bash
git add packages/brain/scripts/fleet-worker/attempt-runner.test.cjs \
  packages/brain/scripts/fleet-worker/fleet-worker.test.js
git commit -m "test(kernel): reproduce Fleet launch receipt race"
```

### Task 2: Implement Worker prepare/start

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`

- [ ] **Step 1: Split Docker creation from start**

Change the adapter boundary from one `launch()` operation to:

```js
async prepare(input) {
  // validate mounts, create FIFOs, and docker create only
  return Object.freeze({ containerId, credentialFifo, githubCredentialFifo });
},
async start({ containerId, credentialFifo, githubCredentialFifo, credential, githubCredential }) {
  await runCommand('docker', ['start', containerName], undefined);
  if (githubCredential) await writeGitHubCredential(containerName, containerGitHubCredentialFifo, githubCredential.token);
  if (credential) await writeCredential(containerName, containerCredentialFifo, credential.authJson);
  return Object.freeze({ containerId });
}
```

Keep token material out of persisted state; persist only credential metadata and FIFO paths under the protected attempt runtime root.

- [ ] **Step 2: Add `attemptRunner.prepare()`**

Prepare workspace/resources/container, then save:

```js
{
  attempt_id,
  run_id,
  worker_id,
  lease_owner,
  lease_generation,
  container_id,
  status: 'prepared',
  workspace,
  labels,
  runtime_resources,
}
```

An exact existing state returns its prior receipt only when run, worker, lease, and container identity match; otherwise throw `attempt_already_exists`.

- [ ] **Step 3: Add `attemptRunner.start()`**

Fence by lease, transition `prepared → starting`, start/inject, durably mark non-secret
credential delivery, persist `running`, and attach the existing
`docker.wait().then(finalizeAttempt)` terminal waiter. A Worker restart before delivery confirmation
must clean the old attempt rather than persist Provider/GitHub credentials. A persisted
`running + delivered` state reinstalls its waiter; completed cleanup leaves a minimal persistent
lease tombstone for idempotent terminal start. On failure, execute exact-attempt rollback and return
a bounded error.

- [ ] **Step 4: Add Worker routes**

```js
if (request.method === 'POST' && request.url === '/harness/attempts/prepare') {
  const receipt = await attemptRunner.prepare(body);
  writeJson(response, 202, acceptedReceipt(receipt, attemptToken));
  return;
}
if (request.method === 'POST' && action === 'start') {
  const result = await attemptRunner.start(attemptId, {
    owner: body.lease_owner,
    generation: body.lease_generation,
  });
  writeJson(response, 200, result);
  return;
}
```

Extend the action path allowlist with `start`; remove the legacy one-step launch route after all in-repo callers use prepare/start.

- [ ] **Step 5: Run Worker tests**

Run the Task 1 command. Expected: PASS.

- [ ] **Step 6: Commit Worker Green**

```bash
git add packages/brain/scripts/fleet-worker/attempt-runner.cjs \
  packages/brain/scripts/fleet-worker/fleet-worker.cjs
git commit -m "feat(kernel): prepare Fleet attempts before start"
```

### Task 3: Red tests for Brain receipt-before-start ordering

**Files:**
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`

- [ ] **Step 1: Add transport Red tests**

Assert `prepare()` calls `/harness/attempts/prepare`, validates attestation, and `start()` calls `/:id/start` with only lease identity. No credential or task bundle may appear in the start body.

- [ ] **Step 2: Add dispatcher ordering Red test**

Use a deferred `recordLaunchReceipt` promise:

```js
const calls = [];
launcher.prepare.mockImplementation(async () => {
  calls.push('prepare');
  return fleetReceipt;
});
attemptStore.recordLaunchReceipt.mockImplementation(async () => {
  calls.push('receipt');
  return deferredReceipt.promise;
});
launcher.start.mockImplementation(async () => calls.push('start'));

const pending = dispatch(ctx);
await vi.waitFor(() => expect(calls).toEqual(['prepare', 'receipt']));
expect(launcher.start).not.toHaveBeenCalled();
deferredReceipt.resolve(receiptRow);
await pending;
expect(calls).toEqual(['prepare', 'receipt', 'start']);
```

- [ ] **Step 3: Add receipt failure Red test**

When receipt persistence fails, assert `cancel()` targets the prepared attempt, `start()` is never called, and the attempt becomes `launch_receipt_persist_failed`.

- [ ] **Step 4: Run Red tests**

```bash
cd packages/brain
npx vitest run src/orchestrator/remote-bridge-transport.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/preflight/production-wiring.test.js
```

Expected: FAIL because the production transport exposes only `launch()` and dispatcher starts before receipt commit.

- [ ] **Step 5: Commit Brain Red tests**

```bash
git add packages/brain/src/orchestrator/remote-bridge-transport.test.js \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/preflight/production-wiring.test.js
git commit -m "test(kernel): require receipt commit before Fleet start"
```

### Task 4: Implement Brain two-phase dispatch

**Files:**
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Modify: `packages/brain/src/orchestrator/production-transport.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`

- [ ] **Step 1: Split transport operations**

Move the current credential-envelope and launch body logic into `prepare()`. Add `start()` using the same authenticated request helper and verify a bounded result:

```js
{ status: 'running', attempt_id: attempt.id }
```

- [ ] **Step 2: Guard prepare/start configuration**

`prepare()` requires the Fleet workspace contract. `start()`, `inspect()`, `cancel()`, and `terminal()` require only a configured exact target.

- [ ] **Step 3: Enforce dispatcher order**

Replace `launcher.launch()` with `launcher.prepare()`, freeze/validate the receipt, persist it, then call `launcher.start()`. Return `LAUNCHED` only after start acknowledges. Use `launch_start_failed` for a post-receipt start failure and exact-attempt cancel cleanup.

- [ ] **Step 4: Run Task 3 tests**

Expected: PASS.

- [ ] **Step 5: Commit Brain Green**

```bash
git add packages/brain/src/orchestrator/remote-bridge-transport.js \
  packages/brain/src/orchestrator/production-transport.js \
  packages/brain/src/orchestrator/dispatcher.js
git commit -m "fix(kernel): commit Fleet receipt before Runner start"
```

### Task 5: Red tests for expired missing attempts

**Files:**
- Create: `packages/brain/src/orchestrator/expired-attempt-reconciler.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/loop.test.js`

- [ ] **Step 1: Add policy Red tests**

Cover:

```js
await reconcileExpiredAttempt({ attempt: expired, inspect: async () => ({ status: 'missing' }) });
expect(attemptStore.fail).toHaveBeenCalledWith(
  expired.id,
  expect.objectContaining({
    code: 'worker_attempt_missing_after_lease',
    failureClass: 'infrastructure_blocked',
  }),
  expect.objectContaining({ leaseGeneration: expired.lease_generation }),
);
```

Also assert `prepared` reclaims then starts, `running` reclaims without creating a new attempt, and inspect errors produce infrastructure backoff rather than product failure.

- [ ] **Step 2: Add loop Red test**

An expired `running` attempt with Worker `missing` must not select `wait:running`; after reconciliation the next derive may dispatch the same role under existing retry limits.

- [ ] **Step 3: Run Red tests**

```bash
cd packages/brain
npx vitest run src/orchestrator/expired-attempt-reconciler.test.js \
  src/orchestrator/__tests__/loop.test.js
```

Expected: FAIL because the reconciler does not exist.

- [ ] **Step 4: Commit recovery Red tests**

```bash
git add packages/brain/src/orchestrator/expired-attempt-reconciler.test.js \
  packages/brain/src/orchestrator/__tests__/loop.test.js
git commit -m "test(kernel): reproduce expired missing Worker attempt"
```

### Task 6: Implement expired-attempt reconciliation

**Files:**
- Create: `packages/brain/src/orchestrator/expired-attempt-reconciler.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/run.js`

- [ ] **Step 1: Implement the focused reconciler**

Export one function that accepts the attempt, clock, launcher, attempt store, and append function. It returns one of `not_expired`, `reclaimed_prepared`, `replacement_required`, `reclaimed_running`, `missing_terminalized`, or `infrastructure_blocked`.

- [ ] **Step 2: Preserve fencing and append evidence**

Reclaim with a new lease generation before any start/observe action.
`attempt_credentials_unavailable` or unconfirmed credential delivery exact-cancels the old attempt
and selects `replacement_required`; the next derive creates a new attempt with fresh envelopes. A
missing Worker state writes a bounded infrastructure failure and an append-only decision detail
containing only attempt ID, prior generation, target, and signature.

- [ ] **Step 3: Wire before normal derive**

In the loop, reconcile the oldest expired in-flight attempt before `derive()`, recollect ground truth after any mutation, and continue. Ensure every path increments a hop or sleeps so no hot loop is possible.

- [ ] **Step 4: Run Task 5 tests**

Expected: PASS.

- [ ] **Step 5: Commit recovery Green**

```bash
git add packages/brain/src/orchestrator/expired-attempt-reconciler.js \
  packages/brain/src/orchestrator/loop.js packages/brain/src/orchestrator/run.js
git commit -m "fix(kernel): converge expired missing Fleet attempts"
```

### Task 7: Version, definition, and regression verification

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `package-lock.json`
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Bump Brain patch version**

Update `1.267.185` to `1.267.186` in package metadata and describe the prepare/receipt/start invariant plus expired-attempt recovery in `DEFINITION.md`.

- [ ] **Step 2: Run focused suites**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs \
  scripts/fleet-worker/fleet-worker.test.js \
  src/orchestrator/remote-bridge-transport.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/expired-attempt-reconciler.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/routes/harness-callback.test.js \
  src/orchestrator/preflight/production-wiring.test.js
```

Expected: all tests pass with zero unhandled rejections.

- [ ] **Step 3: Run Fleet shell/runtime suites**

```bash
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
```

Expected: both scripts exit 0.

- [ ] **Step 4: Run Brain regression suite**

```bash
cd packages/brain
npm test
```

Expected: exit 0.

- [ ] **Step 5: Commit version/definition**

```bash
git add packages/brain/package.json package-lock.json packages/brain/DEFINITION.md
git commit -m "chore(brain): bump version for two-phase Fleet launch"
```

### Task 8: PR, deployment, and real Kernel proof

**Files:**
- No new product files; operational evidence is recorded in the PR and production database.

- [ ] **Step 1: Self-review the exact diff**

```bash
git diff origin/main...HEAD --check
git status --short
```

Expected: no whitespace errors and no unrelated files.

- [ ] **Step 2: Push branch and open one infrastructure PR**

The PR body must include the production attempt/run IDs, Red signatures, exact test commands, rollback, and confirm that no Phase 4B/4C/4D or business code is included.

- [ ] **Step 3: Fix all CI/review findings and squash merge**

Do not merge until current head has all required checks green. Never push directly to main.

- [ ] **Step 4: Deploy Brain and reinstall US M4 Fleet Worker**

Verify `/health`, pinned Runner digest, Node admission, and that tick remains stopped.

- [ ] **Step 5: Recover the production R4 orphan through the implemented mechanism**

Restart only the dedicated controller. Verify attempt `863fdc22-ad3e-4e89-a8ce-6323cf9b9917` becomes an explicit infrastructure terminal row and a new Reviewer attempt is created without duplicate active controllers.

- [ ] **Step 6: Complete real roles**

Observe Reviewer → contract persistence → Generator → Evaluator → Independent Judge → Reporter. Require Evaluator and Judge verdicts to bind the identical final SHA and preserve their execution receipts.

- [ ] **Step 7: Merge the business PR only after the exact-SHA gate**

Confirm CI is still green on that SHA, record the final evidence, merge through PR, and stop at the independent stage boundary without claiming Phase 5 or the full PRD complete.
