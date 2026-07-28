# Kernel Grant Execution/Revocation Linearization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grant execution and revocation linearizable through PostgreSQL so the Kernel production controller can report `blocked` only after durable proof that no external effect was possible.

**Architecture:** Add an immutable grant anchor, append-only execution events, and an irreversible revocation tombstone in PostgreSQL. A server-owned authority holds a shared session advisory lock around the actual execution seam and an exclusive lock around revocation; protected files remain transport artifacts and are executable only after matching durable publication.

**Tech Stack:** Node.js ESM, PostgreSQL 15, `pg`, Vitest, existing Kernel equivalence runtime/controller modules, SQL migrations 381–382.

---

## File map

- Create `packages/brain/migrations/382_kernel_equivalence_grant_authority.sql`: durable grant anchor, event, revocation, immutability, expiry, and append-order contracts.
- Create `packages/brain/src/lib/kernel-equivalence-grant-execution-authority.js`: the only database capability allowed to publish, admit, execute, and revoke exact grants.
- Create `packages/brain/src/lib/__tests__/kernel-equivalence-grant-execution-authority.test.js`: fast query-contract and failure-semantics tests.
- Create `packages/brain/src/__tests__/kernel-equivalence-grant-authority-migration.test.js`: static migration shape and anti-regression checks.
- Create `packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js`: real PostgreSQL concurrency and crash-ordering proof.
- Modify `packages/brain/src/lib/kernel-equivalence-protected-grant-authority.js`: preserve filesystem validation, bind publication and resolution to the durable authority, and make cleanup non-authoritative.
- Modify `packages/brain/src/lib/kernel-equivalence-postgres-runtime.js`: remove standalone nonce authority in favor of the grant execution authority.
- Modify `packages/brain/src/lib/kernel-equivalence-runtime-loader.js`: construct and inject one server-owned frozen authority.
- Modify `packages/brain/src/lib/kernel-equivalence-drills.js`: route nonce admission and the actual seam through the authority.
- Modify `packages/brain/src/lib/kernel-equivalence-trusted-execution-service.js`: carry the exact canonical grant digest from resolution to runtime.
- Modify `packages/brain/src/lib/kernel-equivalence-production-wiring.js`: inject the same durable authority into issuer, reader, runtime, and controller.
- Modify `packages/brain/src/lib/kernel-equivalence-production-coordinator.js`: use structured revocation, settle every post-publication event-write failure, and cap reconciliation TTL with database authority.
- Modify `packages/brain/migrations/381_kernel_equivalence_production_controller.sql`: require active expiries to be later than database time after locking the lease.
- Modify the colocated unit/integration tests named in each task.
- Modify `.brain-versions`, `DEFINITION.md`, `packages/brain/DEFINITION.md`, `packages/brain/package.json`, and lockfiles only after all behavior is green.

### Task 1: Durable grant-authority schema

**Files:**
- Create: `packages/brain/migrations/382_kernel_equivalence_grant_authority.sql`
- Create: `packages/brain/src/__tests__/kernel-equivalence-grant-authority-migration.test.js`
- Create: `packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js`

- [ ] **Step 1: Write the failing static migration contract**

Add assertions that migration 382 creates:

```js
expect(sql).toMatch(/CREATE TABLE kernel_equivalence_grant_authorities/i);
expect(sql).toMatch(/grant_sha256 TEXT NOT NULL CHECK \(grant_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
expect(sql).toMatch(/CREATE TABLE kernel_equivalence_grant_events/i);
expect(sql).toMatch(/'published'.*'execution_intent'.*'effect_completed'.*'aborted_before_effect'.*'effect_unknown'/s);
expect(sql).toMatch(/CREATE TABLE kernel_equivalence_grant_revocations/i);
expect(sql).toMatch(/pg_advisory_xact_lock/i);
expect(sql).toMatch(/clock_timestamp\(\)/i);
expect(sql).toMatch(/prevent_kernel_equivalence_grant_mutation/i);
```

Also assert the migration has no `DROP TABLE`, no `ON DELETE CASCADE`, and no update/delete escape hatch for the three authority relations.

- [ ] **Step 2: Run the static test and verify RED**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/kernel-equivalence-grant-authority-migration.test.js
```

Expected: FAIL because migration 382 does not exist.

- [ ] **Step 3: Write real PostgreSQL RED tests**

Create fixtures that apply migrations through 382 and prove:

```js
await expect(insertAnchor({ expiresAt: past })).rejects.toThrow();
await expect(insertAnchor({ expiresAt: afterCaseOrLease })).rejects.toThrow();
await expect(updateAnchor()).rejects.toThrow(/immutable/i);
await expect(deletePublishedEvent()).rejects.toThrow(/immutable/i);
await expect(deleteRevocation()).rejects.toThrow(/immutable/i);
await expect(appendIntentBeforePublished()).rejects.toThrow();
await expect(appendSecondTerminalForOneIntent()).rejects.toThrow();
```

Use database `clock_timestamp()` in setup to create both valid and already-expired authorities; never compare active expiry to caller-provided `occurred_at`.

- [ ] **Step 4: Implement migration 382**

Define:

```sql
CREATE TABLE kernel_equivalence_grant_authorities (
  grant_id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES kernel_equivalence_production_cases(case_id),
  cell_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
  resource_kind TEXT NOT NULL,
  resource_identity JSONB NOT NULL,
  grant_sha256 TEXT NOT NULL CHECK (grant_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE kernel_equivalence_grant_events (
  grant_id UUID NOT NULL REFERENCES kernel_equivalence_grant_authorities(grant_id),
  generation BIGINT NOT NULL CHECK (generation > 0),
  state TEXT NOT NULL CHECK (state IN (
    'published', 'execution_intent', 'effect_completed',
    'aborted_before_effect', 'effect_unknown'
  )),
  actor_instance_id TEXT NOT NULL,
  grant_sha256 TEXT NOT NULL CHECK (grant_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (grant_id, generation)
);

CREATE TABLE kernel_equivalence_grant_revocations (
  grant_id UUID PRIMARY KEY REFERENCES kernel_equivalence_grant_authorities(grant_id),
  grant_sha256 TEXT NOT NULL CHECK (grant_sha256 ~ '^[0-9a-f]{64}$'),
  controller_instance_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('safe_no_effect', 'effect_possible')),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

Add `SECURITY DEFINER` append functions that lock and validate the production lease, case, attempt, and exact digest; allocate `generation = COALESCE(MAX(generation), 0) + 1`; allow exactly one `published`, require it before intent, and require each terminal event to correspond to an unmatched intent. Add triggers rejecting `UPDATE`, `DELETE`, or `TRUNCATE`, and revoke direct table mutation from the application role while granting only the functions it needs.

- [ ] **Step 5: Run migration tests and verify GREEN**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/kernel-equivalence-grant-authority-migration.test.js \
  src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js
```

Expected: both files PASS; expired anchors and all mutations are rejected by PostgreSQL.

- [ ] **Step 6: Commit the schema**

```bash
git add packages/brain/migrations/382_kernel_equivalence_grant_authority.sql \
  packages/brain/src/__tests__/kernel-equivalence-grant-authority-migration.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js
git commit -m "feat(kernel): add durable grant authority schema"
```

### Task 2: PostgreSQL execution/revocation capability

**Files:**
- Create: `packages/brain/src/lib/kernel-equivalence-grant-execution-authority.js`
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-grant-execution-authority.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js`

- [ ] **Step 1: Write the public API and validation RED tests**

Test this exact constructor and frozen interface:

```js
const authority = createPostgresGrantExecutionAuthority({
  pool,
  actorInstanceId: 'runtime-a',
  lockTimeoutMs: 2_000,
});

expect(Object.isFrozen(authority)).toBe(true);
expect(Object.keys(authority).sort()).toEqual([
  'consumeNonceIfActive',
  'invokeWhileActive',
  'markGrantPublished',
  'registerPendingGrant',
  'resolveActiveGrant',
  'revokeGrant',
].sort());
```

Reject missing pool, malformed UUID/digest, mismatched digest, non-positive timeout, caller-owned connection, and non-function `invoke`.

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
cd packages/brain
npx vitest run src/lib/__tests__/kernel-equivalence-grant-execution-authority.test.js
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement exact identity and lock helpers**

Implement and keep private:

```js
function advisoryKeyForGrant(grantId) {
  const digest = createHash('sha256').update(grantId, 'utf8').digest();
  return digest.readBigInt64BE(0);
}

async function acquireSessionLock(client, key, mode, timeoutMs) {
  await client.query(`SET LOCAL statement_timeout = ${validatedTimeout}`);
  await client.query(
    mode === 'shared'
      ? 'SELECT pg_advisory_lock_shared($1::bigint)'
      : 'SELECT pg_advisory_lock($1::bigint)',
    [key.toString()],
  );
}
```

Use a dedicated `pool.connect()` client per session lock. Release with the matching `pg_advisory_unlock[_shared]` in `finally`, destroy the client on ambiguous connection errors, and return stable frozen error details without exposing raw SQL or credentials.

- [ ] **Step 4: Implement publication and active resolution**

Implement:

```js
await authority.registerPendingGrant({ case_id, grant, grant_sha256 });
await authority.markGrantPublished({
  grant_id: grant.grant_id,
  grant_sha256,
});
const resolved = await authority.resolveActiveGrant({
  cell_id,
  grant_ref,
  grant_sha256,
});
```

`resolveActiveGrant` must require exact ID, ref, cell, canonical digest, `published`, no revocation, case/lease still active, and `expires_at > clock_timestamp()`. Return a new frozen server-owned value, never a database row object.

- [ ] **Step 5: Implement short nonce admission**

`consumeNonceIfActive({ grant, signal, timeoutMs })` must acquire a shared session lock, begin a transaction, lock and revalidate exact authority, insert the existing nonce row, commit, release the lock, and release the connection before adapter preparation. Abortion before commit must roll back and not consume the nonce.

- [ ] **Step 6: Implement seam execution**

`invokeWhileActive({ grant, signal, timeoutMs, invoke })` must:

```js
await acquireSharedLock();
await revalidateExactAuthority();
await appendEvent('execution_intent');
try {
  const value = await invoke(signal);
  await appendEvent('effect_completed');
  return value;
} catch (error) {
  await appendEvent(
    error.effectStarted === false ? 'aborted_before_effect' : 'effect_unknown',
    { error_code: stableCode(error) },
  );
  throw error;
} finally {
  await releaseSharedLock();
}
```

If intent commits and any terminal write is ambiguous, attempt `effect_unknown`, destroy an uncertain client, and throw `KERNEL_GRANT_EFFECT_UNKNOWN`. Never invoke the callback before durable intent.

- [ ] **Step 7: Implement exclusive revocation**

`revokeGrant({ grant_ref, grant_sha256, controller_instance_id, reason, timeoutMs })` must acquire the exclusive session lock, lock the exact anchor, inspect events, insert one tombstone, and return exactly:

```js
Object.freeze({
  grant_ref,
  revoked: true,
  safe_no_effect,
  effect_possible: !safe_no_effect,
  disposition: safe_no_effect ? 'safe_no_effect' : 'effect_possible',
});
```

Only “no intent exists” or “all intents ended `aborted_before_effect`” is safe. Missing anchor, digest mismatch, timeout, connection loss, unfinished intent, completed effect, or unknown effect must throw/return an uncertainty that the controller maps to `settlement_unknown`, never `blocked`.

- [ ] **Step 8: Add real concurrency tests**

Use two dedicated clients and test barriers to prove:

```js
expect(effectCount).toBe(0); // exclusive revoke acquired first
expect(revokeResult.effect_possible).toBe(true); // shared execution acquired first
expect(revokeWaitedForExecution).toBe(true);
expect(crashedIntentDisposition).toBe('effect_possible');
expect(nonceWinnerCount + revokeWinnerCount).toBe(1);
```

Terminate the execution client after committed intent to prove PostgreSQL releases the lock but the durable intent prevents a false safe result.

- [ ] **Step 9: Run unit and real PostgreSQL tests**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-grant-execution-authority.test.js \
  src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js
```

Expected: PASS, including both lock orderings and simulated connection death.

- [ ] **Step 10: Commit the authority**

```bash
git add packages/brain/src/lib/kernel-equivalence-grant-execution-authority.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-grant-execution-authority.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js
git commit -m "feat(kernel): linearize grant execution and revocation"
```

### Task 3: Protected-file publication becomes transport-only

**Files:**
- Modify: `packages/brain/src/lib/kernel-equivalence-protected-grant-authority.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-protected-grant-authority.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-protected-grant-issuer.test.js`

- [ ] **Step 1: Write RED tests for durable publication ordering**

Construct issuer and reader with required `grantExecutionAuthority`. Assert:

```js
expect(calls).toEqual([
  'registerPendingGrant',
  'write-temp',
  'fsync-file',
  'rename',
  'fsync-directory',
  'markGrantPublished',
]);
```

When `markGrantPublished` fails, the issuer removes only the exact inode it published and rejects with `KERNEL_GRANT_PUBLICATION_UNCERTAIN`. When directory fsync fails, no `published` event is written. A restored or replacement file without active durable publication is rejected.

- [ ] **Step 2: Run issuer/reader tests and verify RED**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-protected-grant-authority.test.js \
  src/lib/__tests__/kernel-equivalence-protected-grant-issuer.test.js
```

Expected: FAIL because durable authority is not required or called.

- [ ] **Step 3: Bind the canonical full-grant digest**

Add one exported deterministic helper:

```js
export function canonicalGrantSha256(grant) {
  return createHash('sha256')
    .update(canonicalJson(exactSignedGrantFields(grant)), 'utf8')
    .digest('hex');
}
```

The digest must include every signed field, signature, resource identity, nonce, issued/expiry time, case/run/attempt/cell IDs, and grant ID/ref. Reader and issuer must use the same helper and reject any extra or missing signed field.

- [ ] **Step 4: Implement ordered publication and durable resolution**

Require:

```js
createProtectedGrantFileIssuer({
  grantRoot,
  grantExecutionAuthority,
  maximumTtlSeconds,
  now,
});
createProtectedGrantFileAuthority({
  grantRoot,
  grantExecutionAuthority,
  now,
});
```

Issuer order is anchor → protected file fsync/rename/directory fsync → published event. Reader performs existing mode/owner/inode/signature checks, computes the digest, then calls `resolveActiveGrant`; the returned grant carries the exact frozen digest. `revoke` may best-effort unlink a matching inode but never returns a safety disposition.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: PASS; a valid file without `published` database authority is unusable.

- [ ] **Step 6: Commit the transport integration**

```bash
git add packages/brain/src/lib/kernel-equivalence-protected-grant-authority.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-protected-grant-authority.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-protected-grant-issuer.test.js
git commit -m "fix(kernel): make protected grant files transport only"
```

### Task 4: Runtime execution boundary

**Files:**
- Modify: `packages/brain/src/lib/kernel-equivalence-postgres-runtime.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-runtime-loader.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-drills.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-trusted-execution-service.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-postgres-runtime.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-runtime-loader.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-trusted-execution.test.js`

- [ ] **Step 1: Write RED capability-injection tests**

Assert the runtime loader constructs the authority internally and callers cannot override it. `executeDrillCell` must reject a missing or unfrozen authority and must not accept a standalone `nonceConsumer`.

```js
await expect(executeDrillCell({ ...valid, grantExecutionAuthority: undefined }))
  .rejects.toThrow(/grant execution authority/i);
expect(callerSuppliedAuthority.consumeNonceIfActive).not.toHaveBeenCalled();
```

- [ ] **Step 2: Write RED seam-order tests**

Assert:

```js
expect(order).toEqual([
  'consume-nonce',
  'prepare',
  'invoke-authority-enter',
  'actual-seam',
  'invoke-authority-exit',
  'collect',
  'cleanup',
]);
```

If authority denies after prepare, actual seam and collector stay at zero and cleanup runs once. If authority reports `KERNEL_GRANT_EFFECT_UNKNOWN`, the drill returns uncertainty evidence and never fabricates a safe failure.

- [ ] **Step 3: Run runtime tests and verify RED**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-postgres-runtime.test.js \
  src/lib/__tests__/kernel-equivalence-runtime-loader.test.js \
  src/lib/__tests__/kernel-equivalence-drills.test.js \
  src/lib/__tests__/kernel-equivalence-trusted-execution.test.js
```

Expected: FAIL because runtime still owns a standalone nonce consumer and invokes the seam directly.

- [ ] **Step 4: Replace standalone nonce authority**

Remove `createPostgresNonceConsumer` from production assembly. Construct one frozen `createPostgresGrantExecutionAuthority({ pool, actorInstanceId })` in the runtime loader and pass it to `executeDrillCell`. Keep any compatibility export only if an existing non-production test imports it, and mark it non-authoritative.

- [ ] **Step 5: Wrap the actual seam**

At the existing pre-prepare boundary call:

```js
await grantExecutionAuthority.consumeNonceIfActive({
  grant: exactGrant,
  signal,
  timeoutMs: remainingBudgetMs(),
});
```

At the exact current `adapter.invokeActualSeam` call replace direct invocation with:

```js
const seamOutput = await grantExecutionAuthority.invokeWhileActive({
  grant: exactGrant,
  signal,
  timeoutMs: remainingBudgetMs(),
  invoke: (lockedSignal) => adapter.invokeActualSeam({
    ...seamContext,
    signal: lockedSignal,
  }),
});
```

The adapter never receives the authority, database client, advisory key, or lock.

- [ ] **Step 6: Carry exact digest from UDS resolution**

The trusted execution service must freeze the exact grant plus `grant_sha256` returned by the protected reader and pass only that value to runtime. Reject requests whose caller body attempts to supply or override the digest or authority.

- [ ] **Step 7: Run runtime tests and verify GREEN**

Run the Step 3 command.

Expected: PASS; every actual seam occurs inside `invokeWhileActive`.

- [ ] **Step 8: Commit the runtime boundary**

```bash
git add packages/brain/src/lib/kernel-equivalence-postgres-runtime.js \
  packages/brain/src/lib/kernel-equivalence-runtime-loader.js \
  packages/brain/src/lib/kernel-equivalence-drills.js \
  packages/brain/src/lib/kernel-equivalence-trusted-execution-service.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-postgres-runtime.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-runtime-loader.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-trusted-execution.test.js
git commit -m "fix(kernel): hold grant authority across actual seams"
```

### Task 5: Controller settlement and execution-event failures

**Files:**
- Modify: `packages/brain/src/lib/kernel-equivalence-production-coordinator.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-production-wiring.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-production-coordinator.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-production-wiring.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js`

- [ ] **Step 1: Write RED structured-revocation tests**

Cover the exact table:

```js
expect(await settle(revokeSafe)).toMatchObject({ state: 'blocked' });
expect(await settle(revokeEffectPossible)).toMatchObject({
  state: 'settlement_unknown',
  late_effect_risk: true,
});
expect(await settle(revokeTimeout)).toMatchObject({
  state: 'settlement_unknown',
  late_effect_risk: true,
});
```

File cleanup success or failure must not change the database revocation disposition.

- [ ] **Step 2: Write RED `executing` append-failure test**

Inject failure at the generation-3 `executing` append. Assert durable `revokeGrant` is called with the exact ref and digest, UDS is never called, and:

```js
expect(result.state).toBe(
  revokeResult.safe_no_effect ? 'blocked' : 'settlement_unknown',
);
```

Repeat for `grant_issued` append failure and post-issue validation failure.

- [ ] **Step 3: Run controller tests and verify RED**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-production-coordinator.test.js \
  src/lib/__tests__/kernel-equivalence-production-wiring.test.js \
  src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
```

Expected: at least the naked `executing` append failure test FAILS.

- [ ] **Step 4: Inject one durable authority everywhere**

Production wiring creates one `grantExecutionAuthority` and injects it into protected issuer, protected reader, trusted runtime, and coordinator. Reject partial construction and caller overrides.

- [ ] **Step 5: Centralize post-publication settlement**

Add one coordinator helper:

```js
async function settleAfterPublishedGrantFailure({ grant, reason, cause }) {
  try {
    const revocation = await grantExecutionAuthority.revokeGrant({
      grant_ref: grant.grant_ref,
      grant_sha256: grant.grant_sha256,
      controller_instance_id: controllerInstanceId,
      reason,
      timeoutMs: remainingBudgetMs(),
    });
    return revocation.safe_no_effect
      ? blockedResult(reason)
      : settlementUnknownResult(reason, cause);
  } catch (revokeError) {
    return settlementUnknownResult(reason, revokeError);
  } finally {
    await protectedGrantFiles.cleanupExact(grant).catch(recordCleanupRisk);
  }
}
```

Route `grant_issued`, post-issue validation, `executing`, UDS transport, and ambiguous completion failures through it. No branch may derive `blocked` from `unlink`.

- [ ] **Step 6: Run controller tests and verify GREEN**

Run the Step 3 command.

Expected: PASS; `executing` append failure never reaches UDS.

- [ ] **Step 7: Commit controller settlement**

```bash
git add packages/brain/src/lib/kernel-equivalence-production-coordinator.js \
  packages/brain/src/lib/kernel-equivalence-production-wiring.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-production-coordinator.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-production-wiring.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
git commit -m "fix(kernel): settle controller through durable revocation"
```

### Task 6: Database-time expiry and reconciliation TTL

**Files:**
- Modify: `packages/brain/migrations/381_kernel_equivalence_production_controller.sql`
- Modify: `packages/brain/src/__tests__/kernel-equivalence-production-controller-migration.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-production-coordinator.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-production-coordinator.test.js`

- [ ] **Step 1: Write RED database-time trigger tests**

Insert backdated `occurred_at` events whose active `controller_expires_at` or `grant_expires_at` is already before `clock_timestamp()`. Cover `claimed`, `grant_issued`, `executing`, and `reconciling`:

```js
await expect(insertActiveEvent({
  occurredAt: minutesAgo(10),
  expiresAt: secondsAgo(1),
})).rejects.toThrow(/database time|expired/i);
```

Prove terminal historical events remain insertable when their recorded expiry is elapsed.

- [ ] **Step 2: Write RED effective-TTL tests**

Use database-returned case/lease times. Assert remaining authority of 1.000–1.999 seconds rejects before claim/issue; exactly 2.000 seconds remains valid only when the configured TTL is also at least 2.

```js
await expect(issueWithRemainingMs(1_999))
  .rejects.toThrow(/effective grant ttl.*2 seconds/i);
await expect(issueWithRemainingMs(2_000)).resolves.toBeDefined();
```

- [ ] **Step 3: Write RED reconciliation cap test**

Set configured TTL to 30 seconds and production lease remaining to 3 seconds. Assert the reconciled claim/grant expiry is no later than the database lease expiry and does not cause a trigger rejection or leave the case stuck active.

- [ ] **Step 4: Run expiry tests and verify RED**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/kernel-equivalence-production-controller-migration.test.js \
  src/lib/__tests__/kernel-equivalence-production-coordinator.test.js \
  src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
```

Expected: backdated active expiry and short-lease reconciliation tests FAIL.

- [ ] **Step 5: Enforce database-now active expiry**

In migration 381, after acquiring the production lease row lock, capture database time and require:

```sql
IF NEW.state IN ('claimed', 'reconciling')
   AND NEW.controller_expires_at <= v_database_now THEN
  RAISE EXCEPTION 'active controller authority is expired at database time';
END IF;

IF NEW.state IN ('grant_issued', 'executing')
   AND NEW.grant_expires_at <= v_database_now THEN
  RAISE EXCEPTION 'active grant authority is expired at database time';
END IF;
```

Retain the upper bound `<= LEAST(case.expires_at, lease.lease_expires_at)` and lock order.

- [ ] **Step 6: Use one effective TTL calculation**

Query database `clock_timestamp()`, case expiry, and production lease expiry together and calculate:

```js
const effectiveTtlMs = Math.min(
  configuredGrantTtlMs,
  caseExpiresAtMs - databaseNowMs,
  leaseExpiresAtMs - databaseNowMs,
);
if (effectiveTtlMs < 2_000) {
  throw authorityError('KERNEL_EFFECTIVE_GRANT_TTL_TOO_SHORT');
}
```

Use this exact result for initial claim, grant issue, and reconciliation takeover. Never floor 1.999 seconds to one accepted second.

- [ ] **Step 7: Run expiry tests and verify GREEN**

Run the Step 4 command.

Expected: PASS; short leases are capped and already-expired active events are rejected independently of `occurred_at`.

- [ ] **Step 8: Commit expiry corrections**

```bash
git add packages/brain/migrations/381_kernel_equivalence_production_controller.sql \
  packages/brain/src/__tests__/kernel-equivalence-production-controller-migration.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js \
  packages/brain/src/lib/kernel-equivalence-production-coordinator.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-production-coordinator.test.js
git commit -m "fix(kernel): bind active authority to database time"
```

### Task 7: End-to-end revocation barriers

**Files:**
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-trusted-execution.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js`

- [ ] **Step 1: Write the resolved-before-revoke barrier test**

Use a real protected issuer/reader and a barrier in `adapter.prepare()`:

```js
const request = trustedExecution.execute(validRequest);
await prepareBarrier.entered;
const revoked = await controller.revokeExactGrant(grant);
prepareBarrier.release();
await expect(request).rejects.toMatchObject({
  code: 'KERNEL_GRANT_REVOKED',
});
expect(actualSeam).toHaveBeenCalledTimes(0);
expect(cleanup).toHaveBeenCalledTimes(1);
expect(collector).toHaveBeenCalledTimes(0);
expect(revoked.safe_no_effect).toBe(true);
```

- [ ] **Step 2: Write the execution-first barrier test**

Pause the adapter inside the actual seam after durable intent. Start revocation and prove it waits. Release the seam, then assert:

```js
expect(revocation.effect_possible).toBe(true);
expect(revocation.safe_no_effect).toBe(false);
expect(controllerResult.state).toBe('settlement_unknown');
expect(controllerResult.late_effect_risk).toBe(true);
```

- [ ] **Step 3: Write restored/replaced file tests**

After durable revocation, restore the original bytes under the original path and separately replace the path with another validly signed copy. Both trusted-execution requests must fail at durable resolution, independent of inode/path state.

- [ ] **Step 4: Run the E2E and concurrency proof**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-trusted-execution.test.js \
  src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js \
  src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
```

Expected: PASS with effect count zero for revoke-first and `settlement_unknown` for execution-first.

- [ ] **Step 5: Commit E2E proof**

```bash
git add packages/brain/src/lib/__tests__/kernel-equivalence-trusted-execution.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js \
  packages/brain/src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
git commit -m "test(kernel): prove grant revocation linearization"
```

### Task 8: Version, documentation, and full A1 verification

**Files:**
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify only if generated facts require it: `docs/kernel-equivalence/behavior-ledger.json`

- [ ] **Step 1: Run all focused Kernel unit tests**

Run:

```bash
cd packages/brain
npx vitest run \
  'src/lib/__tests__/kernel-equivalence-*.test.js' \
  'src/__tests__/kernel-equivalence-*.test.js'
```

Expected: all Kernel test files PASS; no new skip.

- [ ] **Step 2: Run all real PostgreSQL controller/authority tests**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/integration/kernel-equivalence-grant-authority.integration.test.js \
  src/__tests__/integration/kernel-equivalence-production-controller.integration.test.js
```

Expected: all tests PASS, including lock ordering, crash, expiry, and barrier cases.

- [ ] **Step 3: Run repository fact and version checks**

Discover the authoritative commands from package scripts and existing CI, then run the exact checked-in commands for:

```text
Kernel equivalence facts
behavior-ledger schema/checker
migration uniqueness/order
Brain definition/version consistency
```

Expected: every command exits 0. The behavior ledger remains honest: `execution_ready=false`, `proven=0`, `missing=99` until live A2/99-cell receipts exist.

- [ ] **Step 4: Update versions and definitions**

Set one consistent Brain patch version in `.brain-versions`, both `DEFINITION.md` files, `packages/brain/package.json`, and both lockfiles. Document:

```text
Migration 382 introduces durable grant execution/revocation authority.
Protected grant files are transport-only.
Actual seams and revocation are PostgreSQL-linearized.
Controller blocked requires durable safe-no-effect proof.
Active expiry uses database time and reconciliation is authority-capped.
```

- [ ] **Step 5: Re-run the complete verification after version edits**

Repeat Steps 1–3 from a clean process.

Expected: identical green result; `git diff --check` exits 0.

- [ ] **Step 6: Independently review against the approved design**

Review every item in sections 2, 4, 5, 6, 7, and 8 of `docs/superpowers/specs/2026-07-29-kernel-grant-linearization-design.md`. Search for direct `invokeActualSeam`, direct grant-table mutations, controller file-derived `blocked`, caller-controlled authority, and unwrapped post-publication event appends. Any finding returns to a RED test before implementation changes.

- [ ] **Step 7: Commit the verified A1 closure**

```bash
git add .brain-versions DEFINITION.md package-lock.json \
  packages/brain/DEFINITION.md packages/brain/package.json \
  packages/brain/package-lock.json docs/kernel-equivalence/behavior-ledger.json
git commit -m "docs(kernel): record durable grant authority"
```

Do not push, open a PR, merge, deploy, mutate staging/production, or claim any of the 99 live cells without explicit user authorization.

## Plan self-review

- Spec coverage: schema and immutability (Task 1), advisory-lock authority and crash semantics (Task 2), transport-only protected files and exact digest (Task 3), server-owned runtime boundary (Task 4), controller settlement rules including naked `executing` append failure (Task 5), database time and effective TTL/reconciliation cap (Task 6), both concurrency orderings and restored-file denial (Task 7), honest proof/version/review closure (Task 8).
- Placeholder scan: no `TBD`, `TODO`, “implement later”, or unspecified “write tests” steps remain.
- Type consistency: all integrations use `grantExecutionAuthority`; methods are `registerPendingGrant`, `markGrantPublished`, `resolveActiveGrant`, `consumeNonceIfActive`, `invokeWhileActive`, and `revokeGrant`; exact identity uses `grant_sha256`; revocation returns `safe_no_effect`, `effect_possible`, and `disposition`.
- Scope boundary: this plan closes A1 only. A2 resource ports, 99 live equivalence receipts, PR/merge, staging, and production remain separate gated work.
