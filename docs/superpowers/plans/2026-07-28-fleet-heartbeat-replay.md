# Fleet Heartbeat Replay Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Fleet heartbeat nonces atomically and make Worker retries reuse the exact signed heartbeat until a verified ACK.

**Architecture:** Migration 371 adds an append-only nonce receipt ledger. `AttemptStore` performs authority validation, lease renewal, receipt insertion, and exact replay dedupe in one transaction; the route only authenticates and maps outcomes. The Worker caches an immutable wire request per current Attempt authority tuple.

**Tech Stack:** Node.js, Express, PostgreSQL, Vitest, `node:test`, HMAC-SHA256.

---

### Task 1: Freeze and add the heartbeat receipt schema

**Files:**
- Create: `packages/brain/migrations/371_kernel_heartbeat_receipts.sql`
- Create: `packages/brain/src/__tests__/kernel-heartbeat-receipt-migration.test.js`
- Create: `packages/brain/src/__tests__/integration/kernel-heartbeat-receipts.integration.test.js`

- [ ] **Step 1: Write failing contract and PostgreSQL integration tests**

Assert the composite unique key, append-only trigger, `ON DELETE RESTRICT`,
schema version 371, rerunnability, and preserved rows after lease expiry.

- [ ] **Step 2: Run tests to verify RED**

Run:
`npx vitest run src/__tests__/kernel-heartbeat-receipt-migration.test.js src/__tests__/integration/kernel-heartbeat-receipts.integration.test.js`

Expected: failure because migration 371 does not exist.

- [ ] **Step 3: Add forward-only migration 371**

Create `harness_heartbeat_receipts` with full authority/request/ACK fields,
`UNIQUE (attempt_id, lease_generation, heartbeat_nonce)`, indexes, and an
append-only update/delete trigger.

- [ ] **Step 4: Run tests to verify GREEN**

Run the Step 2 command and expect all tests to pass.

### Task 2: Implement atomic AttemptStore persistence

**Files:**
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Create: `packages/brain/src/orchestrator/__tests__/attempt-heartbeat-receipt.test.js`

- [ ] **Step 1: Write failing transaction tests**

Cover exact replay dedupe, changed request digest conflict, new stale request,
old exact replay, authority mismatch, rollback, and unique violation mapping.

- [ ] **Step 2: Run tests to verify RED**

Run:
`npx vitest run src/orchestrator/__tests__/attempt-heartbeat-receipt.test.js`

Expected: failure because `persistFleetHeartbeat` is absent.

- [ ] **Step 3: Implement the transactional method and typed conflict**

Lock the Attempt, check an existing nonce first, enforce freshness only for a
new nonce, renew the lease, insert the immutable receipt, and commit.

- [ ] **Step 4: Run tests to verify GREEN**

Run the Step 2 command and expect all tests to pass.

### Task 3: Route exact replay through the durable receipt

**Files:**
- Modify: `packages/brain/src/orchestrator/fleet-callback-auth.js`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: Write failing route tests**

Assert identical retry returns the stored ACK, altered reuse returns 409, and a
new stale nonce still returns `fleet_heartbeat_stale`.

- [ ] **Step 2: Run tests to verify RED**

Run:
`npx vitest run src/routes/__tests__/harness-attempt-callback.test.js`

Expected: exact replay performs a second lease update and conflict semantics
are unavailable.

- [ ] **Step 3: Add request digest and route/store integration**

Allow stale authenticated parsing only for this route, pass the canonical
request digest to `persistFleetHeartbeat`, and build ACK timestamps from its
receipt.

- [ ] **Step 4: Run tests to verify GREEN**

Run the Step 2 command and expect all tests to pass.

### Task 4: Reuse the Worker heartbeat wire request

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- Modify: `packages/brain/scripts/fleet-worker/result-delivery.test.cjs`

- [ ] **Step 1: Write failing retry tests**

Make the first fetch fail, prove the second call has byte-identical body and
headers with one nonce/clock read, then prove a valid ACK causes the next call
to use a new nonce.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test scripts/fleet-worker/result-delivery.test.cjs`

Expected: retry uses a new nonce and timestamp.

- [ ] **Step 3: Cache one immutable wire request per authority tuple**

Retain pending wire state until verified ACK; discard it when the authority
tuple changes.

- [ ] **Step 4: Run tests to verify GREEN**

Run the Step 2 command and expect all tests to pass.

### Task 5: Full verification and commit

**Files:**
- Verify all files above.

- [ ] **Step 1: Run focused suites**

Run the route, auth, AttemptStore, migration, integration, and Worker suites.

- [ ] **Step 2: Run syntax, lint, and diff checks**

Run `node --check` for CommonJS Worker files, targeted ESLint for changed ESM
files, and `git diff --check`.

- [ ] **Step 3: Commit the reviewed implementation**

Commit only the heartbeat replay design, migration, implementation, and tests
on `cp-07281235-heartbeat-replay`.
