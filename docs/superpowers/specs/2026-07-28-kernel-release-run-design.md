# Kernel ReleaseRun Design

## Scope

Phase 2 extends the Kernel success boundary from an exact-SHA merge receipt to
an exact-SHA production verification receipt. It does not change merge,
credential, mutation, or GitHub read brokers. It does not deploy during
development or tests.

The durable path is:

```text
merged
→ staging_queued
→ staging_running
→ staging_passed
→ production_deploying
→ production_verified
```

`report` and `done` are forbidden before `production_verified`.

## Chosen architecture

ReleaseRun is a server-owned authority separate from the legacy
`staging_e2e_results` table. The legacy table admits `SKIP`, `pending_promote`,
and PR-URL identity; those semantics cannot prove a Kernel release for one
`run_id` and one merge SHA.

Four focused components implement the contract:

1. `release-run-contract.js` validates immutable axes, artifacts, transitions,
   staging observations, and production verification.
2. `release-run-store.js` owns PostgreSQL persistence and one global
   session-level advisory lease held across staging and production.
3. `release-run-executor.js` performs intent-before-effect and
   observation-after-effect recovery.
4. `kernel-handlers.js` hard-gates the existing report chain on the executor's
   durable `production_verified` result.

Effect adapters are injected. Missing adapters and adapter results named
`unknown`, `skipped`, `idle`, `unavailable`, `fail`, or any unrecognized value
are denied. Tests use fakes and never touch staging or production.

## Immutable authority

Migration 374 creates `kernel_release_runs`. A row is unique by Kernel
`run_id` and binds:

- task and run identity;
- repository and PR number;
- source head SHA from the merge intent;
- merge commit SHA from the confirmed merge receipt;
- server-resolved artifact versions and digests;
- `kernel-release/v1` policy version.

Creation reads only a confirmed `kernel_merge_effect_receipts` row. A missing,
malformed, stale, or conflicting merge receipt cannot create a ReleaseRun.
Re-entry must reproduce every immutable field.

Artifact authority is a non-empty, sorted array of exact records:

```json
{
  "name": "brain",
  "version": "1.268.2",
  "digest": "sha256:<64 lowercase hex>"
}
```

The server-owned `resolveArtifactVersions(merge_sha)` adapter supplies these
records. Caller payloads are not artifact authority.

## State and receipts

`kernel_release_transitions` is append-only. A database trigger accepts only
the exact predecessor sequence and at most one row per state. The first state
is `merged`.

`kernel_release_effect_intents` is append-only and has exactly one staging and
one production intent per ReleaseRun. Each intent binds the merge SHA,
artifacts, effect kind, and an idempotency key before any adapter is called.

`kernel_release_effect_receipts` is append-only. A confirmed receipt is unique
per intent. Failed and unconfirmed observations remain durable but never
advance state. Receipt evidence is bounded and contains no adapter exception
text or credentials.

## Lease and recovery

The store obtains a dedicated PostgreSQL client and a single global
session-level advisory lock before reading or changing release state. The same
lock remains held for staging, production deployment, and production
verification. `finally` always unlocks and releases the client. A process
crash releases the PostgreSQL session lock.

For each effect:

1. persist the intent;
2. observe external truth;
3. if already confirmed at the exact merge SHA and artifacts, append the
   confirmed receipt without issuing the effect;
4. if explicitly not applied, issue the adapter with the persisted
   idempotency key;
5. observe again;
6. append a confirmed receipt only for exact evidence.

An unavailable or ambiguous observation never causes a blind replay.

## Staging and production gates

Staging confirms only:

- result exactly `pass`;
- observed merge SHA equals the ReleaseRun merge SHA;
- observed artifacts exactly equal the frozen artifact set.

Production confirms only when all fields are present and exact:

- effect/result exactly `pass`;
- health exactly `pass`;
- version/SHA readback exactly matches merge SHA and frozen artifacts;
- required E2E exactly `pass`;
- deployed versions are non-empty and exact;
- rollback metadata contains a non-empty immutable anchor.

Risk level never changes these checks. `skipped`, `idle`, `unknown`,
`unavailable`, `fail`, stale SHA, missing artifacts, and partial verification
all return `BLOCKED` and do not append a success transition.

## Report boundary

The existing Kernel `report` handler invokes `releaseEffect` before
regression promotion, handoff, OKR synchronization, cleanup, or terminal DB
updates. It continues only when the result is:

```json
{"status":"DONE","release_state":"production_verified"}
```

Every other result is a hard block. The old eager `staging_e2e` task spawn is
removed from this Kernel handler so there is only one release owner.

## Verification

Tests prove:

- migration 374 constraints and append-only triggers;
- exact sequence and rejected shortcuts;
- one lease covers both effects and is released on errors;
- intent precedes effect and observation follows it;
- crash-after-effect recovery does not reissue;
- ambiguous/skip/idle/fail observations deny;
- stale merge SHA or artifacts deny;
- full production evidence is required;
- report/done side effects are absent before `production_verified`;
- replay of an already verified ReleaseRun returns without effects.

