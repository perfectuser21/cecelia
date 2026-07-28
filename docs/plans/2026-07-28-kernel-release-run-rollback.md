# Kernel ReleaseRun Typed Rollback Design

## Goal

Add a post-`production_verified` rollback execution path whose authority,
claims, settlements, and receipts are durable and completely separate from the
production deployment intent. The path is exact-SHA, exact-artifact, restart
observable, fail-closed, and never mutates the forward ReleaseRun state ledger.

## Chosen design

Migration 380 adds an independent rollback sub-ledger:

- an immutable execution authority bound to one ReleaseRun, its merge SHA, the
  exact deployed artifact set, the exact verified rollback target set, and the
  confirmed production effect/rollback receipts;
- append-only claims and renewals, with one claim for one authority;
- an append-only terminal settlement (`succeeded`, `failed`, `unknown`, or
  `aborted`) carrying `late_effect_risk`;
- an immutable success/observation receipt with exact per-artifact readbacks.

Database triggers construct and validate the evidence chain. An authority can
only be inserted while the latest forward transition is
`production_verified`, and only when the confirmed production receipt plus
aggregate and per-artifact rollback receipts match the ReleaseRun's merge SHA
and artifact versions. The receipt must also be the globally latest confirmed
production receipt; an older ReleaseRun cannot authorize a rollback over a
newer deployment. Caller JSON cannot substitute for this evidence.

## Execution

`POST /api/brain/deploy/rollback` validates the deploy token, claims one exact
rollback authority, and starts a hardened sibling controller from the current
immutable Brain image. The worker receives the rollback idempotency credential
and database configuration only through a root-owned `0600` private file.
Neither secret is placed directly in Docker argv or environment; only the
private-file path is passed. Controller output is appended to a host-persistent
per-run log.

Typed routes are fixed in code:

- `brain`: execute the existing `brain-rollback.sh` primitive for the persisted
  exact image tag, then read back the running image digest;
- `workspace`: use the existing retained dashboard release primitive for the
  persisted prior tag, then hash/read back the live artifact;
- `workflow-skills`: restore the persisted ReleaseRun rollback link manifest,
  then read back its exact digest and managed symlink targets.

No command string from the database or writable host checkout is executed.
Rollback route scripts, their guard helpers, and the Brain compose definition
are copied into the immutable controller image. Metadata only supplies values
that pass artifact-specific validation and are passed as fixed argv.
Every retained source is checked against its durable digest before mutation;
each primitive also compares the current online identity with the production
receipt before mutation. Dashboard target SHA validation happens in that same
preflight. Multi-link workflow rollback validates and prepares the complete
target set before changing the first live link, and restores the captured
current links if a later mutation fails.

Forward production and rollback execute in sibling controller containers
pinned to the current immutable Brain image. Replacing
`cecelia-node-brain` therefore cannot kill the lease owner before later routes,
readback, or settlement. Both controller kinds hold the same PostgreSQL
session advisory lock (`kernel-release/production-mutation/v1`) across full
preflight, mutation, readback, and terminal persistence. After acquiring it,
rollback rejects any newer production claim or confirmed receipt and validates
the current identity of every target before the first mutation.

Workflow multi-link rollback uses a durable per-claim WAL. Compensation is
read back against the captured current digest; a compensation fault records
`recovery_required` and retains the journal for an idempotent recovery pass.
The controller uses a bounded `on-failure` restart policy; before ordinary CAS
preflight, a restarted worker detects an interrupted Workflow journal and
performs compensation recovery under the same live claim and global lock.

## Failure semantics

- validation failure before a mutation settles `failed` with
  `late_effect_risk=false`;
- non-zero execution, readback mismatch, timeout, abort, or lease loss after an
  operation may have started settles `unknown` (or `aborted` for an explicit
  abort) with `late_effect_risk=true`;
- terminal authorities are never automatically replayed; a bounded controller
  restart may only resume the same still-live exact claim;
- success settlement runs in an abort-aware transaction; an abort observed
  before commit rolls the transaction back and settles as `aborted`;
- an abort or connection loss while success COMMIT is pending appends a
  durable interrupt through an independent database connection, so observation
  becomes `unknown` with late-effect risk rather than reporting an unqualified
  success;
- a live or uncertain claim blocks another authority for the same ReleaseRun;
- legacy/manual rollback scripts require the dedicated rollback worker
  authority and fail closed otherwise.

## Observation and forward-state isolation

`GET /api/brain/deploy/rollback/:authority_id` reads the durable database
ledger, so status survives Brain restart. Rollback code never inserts into
`kernel_release_transitions`, never creates an effect receipt for staging or
production, and never marks a task done. A database trigger rejects rollback
rows without the already-existing exact `production_verified` evidence chain.

## Verification

Tests cover:

- migration shape, append-only constraints, exact evidence binding, safe rerun,
  and real PostgreSQL N-1 upgrade;
- authority creation/idempotency, one-time claim, renew/settle fencing,
  restart observation, and adversarial tampering;
- typed route validation and fixed argv construction;
- worker success, timeout, abort, lease loss, readback mismatch, and
  late-effect-risk evidence;
- route authentication, legacy/manual denial, and forward-state isolation.
