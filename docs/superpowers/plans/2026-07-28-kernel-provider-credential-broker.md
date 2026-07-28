# Kernel Provider Credential Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver signed, short-lived, single-use Fleet credentials for Codex,
Claude, and Grok without host credential mounts or secret-bearing argv/state.

**Architecture:** Brain reads one allowlisted provider credential file and
issues an HMAC-authenticated v2 envelope bound to the current attempt, run,
machine, lease owner, lease generation, and delivery nonce. Worker verifies the
envelope once and writes its payload through an attempt FIFO into a
provider-specific Runner tmpfs home.

**Tech Stack:** Node.js ESM/CJS, Vitest, node:test, Bash, Docker argv contracts.

---

### Task 1: Freeze controller envelope and loader behavior

**Files:**
- Modify: `packages/brain/src/orchestrator/credential-broker.test.js`
- Modify: `packages/brain/src/orchestrator/credential-broker.js`

- [ ] Add failing tests for Claude/Grok sources, all v2 bindings, short TTL,
  HMAC integrity, account allowlists, and provider-specific expiry.
- [ ] Run the focused Vitest file and confirm the new tests fail for missing
  v2/provider-neutral behavior.
- [ ] Implement the smallest exact v2 broker and protected file loader.
- [ ] Re-run the focused test and commit the green slice.

### Task 2: Freeze Brain transport and preflight behavior

**Files:**
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Modify: `packages/brain/src/orchestrator/__tests__/run.test.js`
- Modify: `packages/brain/src/orchestrator/run.js`

- [ ] Add failing tests proving every non-canary provider gets the exact
  attempt/run/lease binding and canaries never call the broker.
- [ ] Confirm RED against Codex-only transport and wiring.
- [ ] Generalize issuance and wire the Fleet token into the broker signer.
- [ ] Re-run focused Brain tests and commit.

### Task 3: Freeze Worker verification and single-use delivery

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/credential-envelope.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/credential-envelope.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`

- [ ] Add failing tests for signature tamper, payload tamper, replay, expiry,
  wrong run/provider/account/machine/lease, and all provider request paths.
- [ ] Confirm the P0 marker rejection fails for Claude/Grok.
- [ ] Implement exact v2 consumption using the Worker token as HMAC root.
- [ ] Generalize Docker FIFO/tmpfs delivery and prove durable state contains no
  payload or secret.
- [ ] Re-run Worker tests and commit.

### Task 4: Freeze Runner materialization and redaction

**Files:**
- Create: `docker/cecelia-runner/__tests__/entrypoint-provider-credential-envelope.test.sh`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Modify: `docker/cecelia-runner/Dockerfile`

- [ ] Add a failing shell contract that sources the bounded credential block
  and exercises Codex, Claude, and Grok homes.
- [ ] Confirm Claude/Grok fail because only Codex is materialized.
- [ ] Generalize credential preparation, mutation detection, and redaction.
- [ ] Assert no host credential mount appears in the Fleet Docker contract and
  canary handling runs before credential preparation.
- [ ] Re-run Runner shell/node contracts and commit.

### Task 5: Installer, documentation, and verification

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- Modify: `DEFINITION.md`
- Modify: `docs/registry/features/orchestration.yml`

- [ ] Add/install contract assertions for the v2 verifier and Worker-token
  signer wiring.
- [ ] Update Brain definition and feature registry with behavior and rollback.
- [ ] Run focused Brain, Worker, Runner, installer, lint, DevGate, and version
  checks from a clean diff.
- [ ] Commit documentation and report commit hashes without push/PR/deploy.

