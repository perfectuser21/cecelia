# Kernel Attempt Result Channel Bootstrap Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with specification and code-quality review checkpoints.

**Goal:** Close the P0 Kernel Fleet result-loss gap with a Brain-owned, provider-neutral, durable Attempt result channel and receipt-gated cleanup.

**Architecture:** Brain freezes a bounded result-channel descriptor into the persisted TaskBundle. The remote transport copies only that descriptor and the true task identity. Fleet Worker validates both, mounts the existing per-Attempt runtime read-write, and injects the result path. The Runner finalizes role output into a replayable callback envelope. Brain validates server-owned bindings and atomically persists a digest-bound receipt. Worker cleanup is fenced by an exact ack marker and replays pending callbacks after restart.

**Tech Stack:** Node.js ESM (Brain), Node.js CommonJS (Fleet Worker), Bash + jq/curl (Runner), PostgreSQL JSONB, Vitest and shell contract tests.

---

## Task 1: Freeze the result-channel contract in TaskBundle

**Files:**

- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Test: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

**Steps:**

1. Add failing tests proving Fleet TaskBundles require exactly
   `attempt-result-file/v1`, an Attempt-derived path under
   `/tmp/cecelia-prompts`, a bounded positive `max_bytes`, and server-derived
   task/run/attempt/role bindings.
2. Prove legacy TaskBundles remain valid without the descriptor.
3. Implement a small exported builder/parser; reject unknown fields, traversal,
   CR/LF and mismatched identities.
4. Build the descriptor before `createAttempt`, so its exact value is persisted
   in `harness_attempts.task_bundle`.
5. Run the two focused test files and commit the Red tests separately from the
   implementation.

## Task 2: Carry and enforce the contract at the Fleet boundary

**Files:**

- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`

**Steps:**

1. Add failing transport tests proving only the frozen descriptor and true
   `task_id` cross the boundary.
2. Add failing Worker tests for unknown fields, task/run/attempt/role/lease
   mismatch, path escape, symlink/stale file, and oversized result.
3. Validate the launch request before workspace preparation or credential
   consumption.
4. Remove Fleet `callback_token`/`callback_url` from the launch body and Docker
   environment. The provider container must never receive a callback or Worker
   transport secret.
5. Inject `CECELIA_TASK_ID=<true task id>`, `HARNESS_TASK_ID=<true task id>`,
   `BRAIN_RESULT_FILE=<frozen path>` and bounded channel metadata.
6. Create/freshen the host-side result target mode 0600 without following
   symlinks; keep the existing `/tmp/cecelia-prompts` mount.
7. Run transport and Fleet Worker focused tests.

## Task 3: Finalize provider-neutral role output into a replay envelope

**Files:**

- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `docker/cecelia-runner/Dockerfile`
- Add: `docker/cecelia-runner/result-channel-finalizer.cjs`
- Add: `docker/cecelia-runner/result-channel-finalizer.test.cjs`
- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Add: `docker/cecelia-runner/result-channel-contract.test.sh`
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`

**Steps:**

1. Add failing shell cases for Claude/Codex/Grok, read-only workspace, Reviewer
   verdict mapping, Evaluator evidence mapping, missing/invalid/oversized raw
   result, and exact digest generation.
2. Treat `BRAIN_RESULT_FILE` as the only Kernel file output; never fall back to
   source-workspace `.brain-result.json` when the descriptor is required.
3. Normalize role-specific raw JSON through one deterministic Node adapter,
   selected by `expected_output` and role. Preserve an explicitly validated
   `role_result` for planner review policy, proposer artifacts, reviewer rubric,
   Generator PR evidence, Evaluator behavior evidence and Reporter report
   evidence. Lifecycle status and business verdict remain separate.
4. Extend the Brain HarnessResult schema with exact per-role `role_result`
   validation; never rely on permissive passthrough or fields stripped by Zod.
   Server/Runner must verify branch, PR, SHA, artifact, judgment-count and test
   claims before upgrading them to observed evidence.
5. Write the canonical HarnessResult plus provider-session handoff atomically to
   the Attempt runtime. The provider container performs no Fleet callback.
6. Keep legacy non-Fleet callback behavior unchanged.

## Task 4: Persist a durable, idempotent Brain receipt

**Files:**

- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Add: `packages/brain/src/routes/__tests__/harness-result-channel.test.js`
- Add: `packages/brain/migrations/368_allow_fleet_worker_execution_transport.sql`
- Add: `packages/brain/migrations/369_kernel_result_channel_receipts.sql`
- Add: `packages/brain/src/__tests__/kernel-result-channel-migration.test.js`

**Steps:**

1. Add failing callback tests for byte limits, digest mismatch, malformed raw
   JSON, authority-binding mismatch, provider/session mismatch, missing launch
   receipt, same-digest retry and conflicting-digest retry.
2. Derive expected values from the Attempt row and persisted TaskBundle; do not
   accept Agent-provided authority as truth.
3. Persist the server-owned result binding on the Attempt and append the
   terminal receipt to `harness_result_receipts` in one transaction with the
   guarded Attempt terminal update. Store receipt id, binding/digest, byte
   count, lease generation, persisted time and exact bindings.
4. On retry, return the persisted receipt only for the same digest. Return 409
   for a conflicting digest or lease generation.
5. Return a strict ack envelope used by Runner readback.
6. Preserve existing verdict-log and Generator PR side effects after the
   durable write, making each independently idempotent.
7. Migration 368 replaces the migration-363 execution transport CHECK with one
   that includes `fleet-worker`; migration 369 adds server-owned result binding
   fields plus the append-only receipt table. Before rebase/deploy, re-read the
   repository and production `schema_version` ledger and abort on any number or
   description collision.

## Task 5: Fence cleanup and replay callback_pending after restart

**Files:**

- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Add: `packages/brain/scripts/fleet-worker/callback-auth.cjs`
- Add: `packages/brain/scripts/fleet-worker/callback-auth.test.cjs`
- Add: `packages/brain/src/orchestrator/fleet-callback-auth.js`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`

**Steps:**

1. Add failing tests that an exited container without an ack removes only the
   container and retains runtime/workspace/state as `callback_pending`.
2. Persist the immutable result channel and canonical result, but never a
   per-Attempt or Worker token. The protected Fleet transport token remains
   file-backed and exists only in the Worker process.
3. Add domain-separated HMAC for Worker heartbeat/callback and Brain receipt,
   bound to attempt/run/worker/job/lease generation/result digest/delivery id.
   The same canonical request replay is deterministic.
4. Add bounded Worker delivery of the mode-0600 result. Brain verifies the
   Worker signature and launch-receipt tuple; Worker verifies the signed exact
   accepted/deduped receipt before cleanup.
5. Add restart reconciliation tests for pending replay, same receipt retry,
   conflicting ack, missing/corrupt envelope, cancellation and quarantine.
6. Ensure orphan cleanup treats `callback_pending` as retained and never removes
   its runtime directory.
7. Add regression tests proving callback secrets are absent from launch JSON,
   Docker create
   argv, durable state, logs and alert payloads.

## Task 6: Version, regression, independent review and Draft PR

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `.brain-versions`
- Update: `sprints/07280905-kernel-result-channel-bootstrap/contract-dod.md`

**Steps:**

1. Bump Brain patch version in all four SSOT files and document rollback.
2. Run focused suites for execution contract, dispatcher, attempt store,
   transport, callback, Fleet Worker and Runner shell contracts.
3. Run Brain lint/version-sync/DevGate checks relevant to changed files.
4. Request a specification review and a separate code-quality/security review;
   address findings with tests first.
5. Push the exact reviewed commit and create a Draft PR only.
6. Let CI run; diagnose failures. Do not mark ready, merge or deploy until
   Evaluator passes and the owner approves the first-run human gate.
