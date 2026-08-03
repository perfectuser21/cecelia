# Kernel Fleet Two-Phase Launch Design

**Status:** Owner approved on 2026-08-03
**Scope:** One infrastructure-only PR; no Phase 4B/4C/4D product work and no business-PR merge

## Problem

Production run `92a67d1a-2c3a-4819-9930-09d841f31bd8` exposed a launch/callback race on Reviewer attempt `863fdc22-ad3e-4e89-a8ce-6323cf9b9917`:

1. Brain created the attempt and called Fleet Worker launch.
2. Fleet Worker created and started the Runner before Brain durably stored the attested launch receipt.
3. The Runner completed and posted its terminal callback.
4. Brain rejected the callback with `launch_receipt_unconfirmed` because `execution_transport`, `actual_machine_id`, and `remote_job_id` were still null.
5. Fleet Worker removed the terminal container and state, while Brain retained an expired `running` attempt.

The failure is independent of Reviewer skill quality or model selection. The protocol permits execution before the control plane has established the identity needed to accept its result.

## Invariants

- A Runner must not start until Brain has durably bound the attempt to an attested Fleet Worker receipt.
- Callback validation remains fail-closed; an early callback is not trusted or silently buffered without launch identity.
- Prepare, start, inspect, cancel, and terminal operations are authenticated, lease-fenced, exact-attempt scoped, and idempotent.
- A prepared attempt that is never started is recoverable without running provider code: the
  same live Worker may start it from its in-memory one-shot credentials; after Worker restart it
  must be cancelled and replaced with a fresh attempt/envelope rather than persisting credentials.
- An expired Brain attempt whose Worker state is missing becomes an explicit infrastructure terminal result and may retry; it cannot remain `running` forever.
- Tick remains OFF throughout the globally drained cutover and the post-deployment PR #1581
  acceptance run; only the dedicated Kernel controller drives convergence.
- No long-lived Provider/GitHub credential is stored in the Brain database, Worker receipt, argv,
  logs, or long-lived Xi'an filesystem. Attempt-local callback and disposable PostgreSQL values
  remain governed by their existing isolated-container lifecycle.

## Considered Approaches

### A. Two-phase prepare/start protocol — selected

`prepare` creates the disposable workspace, runtime resources, credential envelopes, and stopped Runner container, persists Worker state, and returns an attested receipt. Brain stores the receipt, then calls `start`. Only `start` may run the container and deliver FIFO credentials.

This removes the race structurally and gives crash recovery an explicit prepared state.

### B. Durable early-callback inbox — rejected

Brain could accept and buffer callbacks before receipt persistence. That leaves the callback unverifiable until a receipt arrives and does not solve a permanently lost launch response. It also creates a second result state machine.

### C. Longer launch timeout or callback retries — rejected

This only changes probability. A fast Runner, slow FIFO, network interruption, or Brain restart can still produce the same ordering.

## Protocol

### Prepare

Brain sends `POST /harness/attempts/prepare` with the current path-free launch body. Fleet Worker:

1. validates request, target, credentials, and workspace specification;
2. prepares the workspace and isolated PostgreSQL resource;
3. creates, but does not start, the Runner container;
4. persists Worker state with `status=prepared` and the exact lease generation;
5. returns `202` with the existing attested receipt fields.

An exact duplicate prepare returns the same receipt. A conflicting lease or request returns `409`.

### Receipt commit

Brain validates the attestation and atomically writes `actual_machine_id`, `execution_transport=fleet-worker`, `remote_job_id`, and `machine_attestation_status=verified` to the attempt row. No callback is accepted before this commit.

### Start

Brain sends `POST /harness/attempts/:attemptId/start` with lease owner and generation. Fleet Worker atomically changes `prepared → starting`, starts the exact stopped container, delivers transient GitHub/Codex FIFO credentials, changes Worker state to `running`, and installs the existing terminal waiter.

Start is idempotent for `starting/running/terminal`; stale lease generations are rejected. If start fails, Worker cleans the exact attempt and Brain records `launch_start_failed` as infrastructure failure.

Provider/GitHub credential material remains memory/FIFO-only. Worker state records only a
non-secret `credential_delivery_status`. A crash before `delivered` is durably recorded must clean
and replace the attempt, even if Docker reports the container as running. A persisted
`running + delivered` attempt may reinstall its terminal waiter after restart. Completed cleanup
leaves a minimal, lease-fenced terminal tombstone so duplicate start remains idempotent across a
Worker restart without retaining workspace, runtime, callback, or credential material.

### Terminal callback

The existing callback contract remains strict. Because start occurs only after receipt commit, `launch_receipt_unconfirmed` cannot occur for a protocol-compliant Runner. Existing cleanup receipt, credential evidence, lease fencing, and append-only decision logging remain unchanged.

## Expired Attempt Recovery

The Kernel loop must not treat every `starting/running` row as live forever. When its lease is expired:

1. inspect the attested Worker target using the exact attempt ID;
2. if Worker reports `prepared`, start with the unchanged old owner/generation only when that
   Worker still owns the in-memory one-shot credentials; an exact, confirmed-safe cancel permits a
   replacement attempt with newly issued envelopes;
3. if Worker reports `running`, retain and heartbeat the unchanged old owner/generation. Brain must
   not increment only its database generation because that would fence out the live Worker and its
   callback; an ownership transfer requires a separate atomic Worker lease-rotation protocol;
4. if Worker reports `missing`, atomically fail the attempt with `worker_attempt_missing_after_lease`, append the normal callback-equivalent infrastructure decision evidence, and let derive retry the same role under its existing cap;
5. if Worker inspection is unavailable, record infrastructure BLOCKED/backoff without entering Generator fix.

The run singleton may adopt work only through those idempotent exact-lease operations. Any
inspection, heartbeat, or cancel result that does not prove a safe state fails closed with bounded
infrastructure evidence and backoff.

The relay watchdog is not a second Fleet recovery authority. For an expired Fleet attempt it may
restart the dedicated Kernel controller, but it must not inspect/cancel the Worker, rotate the
database lease, or create a resume child. This avoids a cleanup-versus-heartbeat race and keeps all
old-lease decisions in the reconciler above.

Production run `92a67d1a-2c3a-4819-9930-09d841f31bd8` is terminal FAILED evidence and must never
be resumed, recovered, or resurrected. After deployment, create a new real business Kernel run for
PR #1581 through this mechanism; no fabricated callback or verdict is written for the old run.

## File Boundaries

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`: split prepare from start and persist Worker lifecycle state.
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`: expose authenticated prepare/start routes.
- `packages/brain/src/orchestrator/remote-bridge-transport.js`: add prepare/start transport operations and validate receipts.
- `packages/brain/src/orchestrator/production-transport.js`: expose the two-phase interface.
- `packages/brain/src/orchestrator/dispatcher.js`: commit receipt between prepare and start.
- `packages/brain/src/orchestrator/loop.js` and a focused helper if needed: expired attempt reconciliation.
- Adjacent unit/integration tests only.
- `packages/brain/package.json`, lockfile, and `packages/brain/DEFINITION.md`: synchronized Brain version and behavior definition.

## Verification

Red tests must reproduce both failures:

1. a Runner is not started before `recordLaunchReceipt` resolves;
2. an expired Brain attempt with missing Worker state does not remain `running`.

Concurrency regressions additionally prove that cancel/inspect cannot overtake an in-flight
prepare, receiptless local-Docker attempts never enter Fleet recovery, and watchdog never acts as a
second Fleet recovery authority.

Green verification covers:

- prepare receipt precedes start call;
- callback after start sees confirmed launch identity;
- duplicate prepare/start are lease-fenced and idempotent, including terminal tombstones across
  Worker restart;
- a crash before credential-delivery commit cleans and replaces the attempt, while a durably
  delivered running attempt reinstalls its terminal waiter;
- receipt persistence failure cancels a prepared attempt without starting it;
- stale lease and conflicting request are rejected;
- missing Worker state terminalizes as infrastructure failure and retries within existing caps;
- current callback cleanup, credential, attestation, and infrastructure-backoff suites remain green;
- a newly created real business Kernel run for PR #1581 crosses Reviewer, Generator, Evaluator,
  Independent Judge, and Reporter, with Evaluator and Independent Judge both recording PASS against
  the exact same final head SHA.

## Rollout and Stop Condition

Deploy Brain and Fleet Worker through the globally drained protocol cutover and keep Tick off.
Create a new real business Kernel run for PR #1581; do not resume terminal FAILED run
`92a67d1a-2c3a-4819-9930-09d841f31bd8`. Do not merge PR #1581 until Evaluator and Independent
Judge both record PASS for the exact same final head SHA. Stop after the successful Kernel stage
boundary; do not claim Phase 5 or the full provider-neutral PRD complete.
