# Kernel Grant Execution/Revocation Linearization Design

**Date:** 2026-07-29

**Status:** Approved design

**Scope:** Kernel equivalence production controller A1

**Chosen approach:** Brain-owned PostgreSQL grant authority with a
session-level execution/revocation lock

## 1. Problem

The current protected grant file proves confidential delivery and exact
signed contents, but it cannot prove revocation:

- a path can be replaced between a final identity check and `unlink`;
- a deleted inode may be restored under the original path;
- a trusted-execution request may already hold a frozen in-memory grant when
  the file is deleted;
- a process can die after invoking an external effect but before recording its
  outcome;
- controller code can therefore record `blocked` while an effect remains
  possible.

File deletion must not be the authority used to claim that a grant is safely
revoked.

## 2. Safety invariant

For one exact `grant_id`, execution and revocation have one database-backed
linearization order:

1. If revocation linearizes first, no actual seam may begin.
2. If execution linearizes first, revocation must observe a durable execution
   intent or outcome and must not report a safe, no-effect revocation.
3. `blocked` is permitted only after the authority proves that no effect was
   invoked.
4. Missing, ambiguous, timed-out, crashed, or contradictory evidence produces
   `settlement_unknown` with `late_effect_risk=true`.
5. Restoring, replacing, or retaining a signed grant file cannot reactivate a
   revoked grant.

This invariant applies across concurrent UDS requests, multiple controller
instances, Brain restarts, and database reconnects.

## 3. Rejected approaches

### 3.1 Exact file deletion

Rejected because path-based unlink cannot invalidate a grant already held in
memory and cannot linearize against an external effect.

### 3.2 Database tombstone with point-in-time rechecks

Rejected as insufficient by itself. A revocation can commit after the last
query and before `invokeActualSeam()`.

### 3.3 Separate grant-authority sidecar

This can provide the same invariant, but it introduces another production
service, deployment boundary, credential, and liveness contract. It is larger
than the A1 controller closure and is not required because Brain already owns
the trusted PostgreSQL and runtime assembly.

## 4. Chosen architecture

### 4.1 Durable grant authority

A new additive migration creates three append-oriented relations:

`kernel_equivalence_grant_authorities`

- immutable anchor keyed by `grant_id`;
- binds `case_id`, `cell_id`, `run_id`, `attempt_id`, resource identity,
  canonical full-grant SHA-256, issue deadline, and database issue time;
- references the production case/binding authority;
- rejects issue expiry beyond the case and production lease;
- never stores a private key or credential.

`kernel_equivalence_grant_events`

- append-only events with a monotonic per-grant generation;
- allowlisted states:
  `published`, `execution_intent`, `effect_completed`,
  `aborted_before_effect`, and `effect_unknown`;
- binds every event to the exact controller/runtime instance and grant digest;
- `execution_intent` is committed before the actual seam is invoked;
- a missing terminal event after an intent means effect is possible.

`kernel_equivalence_grant_revocations`

- append-only tombstone keyed by `grant_id`;
- records database revocation time, reason, controller identity, and the
  observed execution disposition;
- duplicate revocation is idempotent only when the exact identity and result
  match;
- deletion, update, truncate, or resurrection is forbidden.

The signed file remains a protected transport artifact. A file is usable only
when its full canonical digest matches a published, unexpired database grant
with no revocation tombstone.

Publication is ordered as follows:

1. Insert the immutable grant anchor.
2. Publish and fsync the protected transport file.
3. Append the database `published` event.

The reader requires step 3. A crash or database failure after file publication
but before the event leaves an unusable orphan file, which maintenance may
remove. It does not create executable authority. A controller may record
`blocked` after a database read proves that no `published` event committed;
an ambiguous read remains `settlement_unknown`.

### 4.2 Session-level lock

Every grant maps deterministically to one PostgreSQL advisory-lock key.
The mapping uses a stable 64-bit digest of the grant UUID. A digest collision
may conservatively serialize unrelated grants, but every operation still locks
and validates the exact UUID anchor, so a collision cannot authorize the wrong
grant.

Nonce admission, at the existing pre-prepare boundary:

1. Checkout one dedicated database connection.
2. Acquire the grant's shared session advisory lock.
3. In a transaction, lock and validate the immutable grant anchor, current
   production case/lease, digest, expiry, and absence of revocation.
4. Atomically consume the nonce while the same authority is valid.
5. Commit, release the short shared lock, and release the connection before
   adapter preparation.

Actual seam execution, after successful preparation:

1. Checkout one dedicated database connection.
2. Acquire the grant's shared session advisory lock again.
3. Revalidate the same complete authority and absence of revocation.
4. Commit `execution_intent`.
5. Keep the shared session lock and connection while invoking the actual seam.
6. Commit exactly one of `effect_completed`, `aborted_before_effect`, or
   `effect_unknown`.
7. Release the shared lock and connection in `finally`.

Revocation:

1. Checkout one dedicated database connection.
2. Acquire the same grant's exclusive session advisory lock with a bounded
   deadline.
3. Lock the grant anchor and read its durable event history.
4. Insert the revocation tombstone.
5. Return:
   - `safe_no_effect=true` only when no execution intent exists, or every
     intent has a durable `aborted_before_effect`;
   - `effect_possible=true` for intent without a no-effect terminal, completed
     effect, unknown effect, timeout, database ambiguity, or lock uncertainty.
6. Commit, release the exclusive lock, then best-effort remove the transport
   file.

This creates the required ordering:

- exclusive revoke lock first → later execution validation sees the tombstone;
- shared execution lock first → revoke waits, then sees the committed intent
  and outcome;
- process death releases the session lock, while a previously committed intent
  remains durable and forces `effect_possible=true`.

The file cleanup result never changes the revocation disposition.

### 4.3 Runtime boundary

The authority is server-owned and cannot be supplied by the UDS caller.

The trusted runtime receives one frozen `grantExecutionAuthority` capability
from the production runtime loader. It exposes bounded operations rather than
raw database access:

- `consumeNonceIfActive(exactGrant)`;
- `invokeWhileActive(exactGrant, invokeActualSeam)`.

`invokeWhileActive` owns the advisory lock, durable intent, callback invocation,
outcome write, and release. The adapter receives no lock or database
capability.

The initial protected-file resolution still validates filesystem ownership,
mode, inode, signature, expiry, cell, and grant ID. Runtime authorization also
compares the complete canonical grant digest with the database anchor; matching
only `grant_ref` or `grant_id` is insufficient.

## 5. Controller behavior

The production controller follows these terminal rules:

| Situation | Required result |
|---|---|
| Grant rejected before publication is durably authoritative | `blocked` |
| Published grant revoked with `safe_no_effect=true` | `blocked` |
| Revocation reports `effect_possible=true` | `settlement_unknown` |
| Revocation lock/transaction/readback is uncertain | `settlement_unknown` |
| `grant_issued` or `executing` event append fails after publication | Revoke through DB authority, then apply the same table |
| Exact durable bundle proves the same grant and effect | `succeeded` |

The controller never derives `blocked` from file deletion.

Restart reconciliation caps its takeover lease to:

```text
min(configured grant TTL,
    production lease expiry - database now,
    case expiry - database now)
```

An effective TTL below two whole seconds fails closed before claim or issue.

## 6. Database-time expiry correction

Migration guards sample database time after acquiring the production lease
lock. They require:

- active controller leases to be later than database now;
- `grant_issued` and `executing` grant expiry to be later than database now;
- all non-null grant/controller expiries to be no later than
  `LEAST(case.expires_at, production_lease.lease_expires_at)`;
- terminal historical evidence may contain an already elapsed expiry.

Caller-controlled `occurred_at` is evidence only and cannot establish current
authority.

Lock ordering remains:

```text
production lease
→ production case
→ Attempt
→ binding
→ result receipt
→ execution fence
```

Grant advisory locks are acquired before grant-authority row locks and are not
acquired by the production-case lease-transition trigger.

## 7. Failure and crash semantics

- A database error before durable `execution_intent` means no seam invocation
  is permitted.
- A database error after durable intent but before a proven no-effect terminal
  means `effect_unknown`.
- Process death after intent is treated as effect possible, even if no bundle
  exists.
- Cancellation is safe only when the runtime durably records
  `aborted_before_effect`.
- A timeout acquiring either advisory lock is uncertainty, not success.
- Cleanup failure remains independent late-effect risk and cannot be hidden by
  revocation.
- Reconciliation may promote `settlement_unknown` to `succeeded` only with the
  exact grant-bound durable bundle.

## 8. Test and proof plan

All behavior changes use RED → GREEN permanent regressions.

### Unit and contract tests

1. Revoke wins before execution: effect count 0, cleanup confirmed, no bundle.
2. Execution wins before revoke: revoke waits and cannot return safe no-effect.
3. Already resolved in-memory grant is denied after a prior revocation.
4. Restored original inode and replacement file remain revoked.
5. Same ref/ID with any changed signed field or digest is rejected.
6. `executing` event append failure invokes durable revoke and never calls UDS.
7. Effective remaining TTL from 1.000–1.999 seconds never reaches issuer.
8. Configured TTL 2 seconds remains a valid configuration when authority has
   sufficient remaining time.
9. Backdated `occurred_at` cannot admit an already expired active event.

### Real PostgreSQL concurrency tests

1. Shared execution lock first, exclusive revoke waits, committed intent is
   observed.
2. Exclusive revoke first, shared execution acquisition is denied.
3. Simulated connection death after committed intent forces effect-possible
   revocation.
4. Nonce consumption and revocation cannot both linearize as first.
5. Short remaining production lease caps reconciliation takeover.
6. Database trigger rejects expired-at-insert claim, grant, executing, and
   reconciling events.

### End-to-end trusted-runtime test

Use a real protected issuer/reader and a barrier in `adapter.prepare()`:

1. UDS resolves the grant and pauses.
2. Controller revokes the exact grant.
3. Release prepare.
4. Assert actual seam count 0, cleanup count 1, collector count 0, and denial
   bound to the exact grant.

A second ordering lets the runtime acquire its execution lock first and proves
that the controller records uncertainty rather than false `blocked`.

## 9. Scope boundaries

This design closes A1 controller/grant authority only. It does not:

- implement A2 branch/workspace/credential/staging/database resource ports;
- claim any of the 99 live equivalence cells as proven;
- authorize push, PR, merge, deployment, production mutation, or human-review
  bypass;
- change the 11-behavior ledger's honest `0/99` status.

After A1 is independently re-reviewed and integrated locally, A2 design and
the 99 live drills remain required before the Kernel Harness Golden Path can be
declared equivalent.
