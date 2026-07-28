# Fleet GitHub Mutation Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Worker-owned, credential-isolated GitHub push and draft-PR
broker for managed Kernel Generator Attempts.

**Architecture:** Brain freezes an exact mutation policy in TaskBundle and
remote launch JSON. Runner stages only a provider declaration. Worker removes
the provider container, validates Git objects and policy, performs
force-with-lease push/draft PR through argv-only host commands, journals every
stage, finalizes the Generator result and resumes existing receipt delivery.

**Tech Stack:** Node.js ESM/CJS, Git/GitHub CLI through `execFile`, JSONL
SHA-256 audit chain, Vitest/node:test, Bash contract tests.

---

### Task 1: Freeze and transport mutation policy

**Files:**
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Test: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`

- [ ] Write RED tests requiring exact `github-mutation/v1` bindings for Fleet
  Generator bundles and proving the policy crosses transport unchanged.
- [ ] Run focused tests and confirm missing policy/builder failures.
- [ ] Implement strict policy parser/builder and server-owned allowlist.
- [ ] Build the policy after workspace resolution; include it only for
  Generator and copy it into Fleet launch JSON.
- [ ] Run focused tests and commit.

### Task 2: Implement the pure Worker broker

**Files:**
- Create: `packages/brain/scripts/fleet-worker/github-mutation-broker.cjs`
- Create: `packages/brain/scripts/fleet-worker/github-mutation-broker.test.cjs`

- [ ] Write RED node tests for exact bindings, argv-only commands, no
  credential serialization, path/secret/symlink/submodule/binary rejection,
  lease conflict, draft-only PR, crash-before/after-push and idempotent retry.
- [ ] Run the test and confirm the missing module failure.
- [ ] Implement strict parsing, Git object verification, append+fsync chained
  audit store and deterministic recovery.
- [ ] Reuse `finalizeRoleResult` to build the canonical Generator result.
- [ ] Run tests and commit.

### Task 3: Wire Runner staging and Worker lifecycle

**Files:**
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `docker/cecelia-runner/entrypoint-managed-result-channel.test.sh`
- Modify: `packages/workflows/skills/harness-generator/SKILL.md`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`

- [ ] Add RED contracts for declaration-only managed Generator output,
  provider-result staging, no GitHub credential Docker env/mount, durable
  `mutation_pending`, container removal before broker, restart replay and
  canonical result write.
- [ ] Run focused tests and confirm lifecycle failures.
- [ ] Add fixed runtime files and strict no-follow reads/writes.
- [ ] Persist mutation policy/status, invoke broker after container removal,
  and resume callback only after canonical result exists.
- [ ] Configure the Worker-only broker and update managed Generator guidance.
- [ ] Run focused tests and commit.

### Task 4: Install and verify the trusted broker

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`

- [ ] Add RED shell tests requiring broker/finalizer installation and proving
  no credential is archived, printed or mounted into Runner Docker argv.
- [ ] Install the broker and shared finalizer as root-owned runtime files and
  include their sources in rollout.
- [ ] Run shell contracts and commit.

### Task 5: Regression and handoff

- [ ] Run Worker, Brain contract/dispatcher/transport, Runner result-channel
  and install/rollout focused suites.
- [ ] Run `git diff --check` and inspect the entire branch diff for secrets.
- [ ] Record inherited unrelated failures separately.
- [ ] Commit the exact reviewed state and report commit plus remaining
  credential-provisioning limitation.
