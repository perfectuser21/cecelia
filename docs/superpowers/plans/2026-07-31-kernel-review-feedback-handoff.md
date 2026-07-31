# Kernel Reviewer Feedback Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver SHA-anchored Reviewer feedback to the next Kernel GAN Proposer.

**Architecture:** Ground truth projects a bounded feedback object from the latest
matching completed Reviewer attempt. Dispatcher copies it into only the next
Proposer TaskBundle.

**Tech Stack:** Node.js, PostgreSQL JSONB records, Vitest.

---

### Task 1: Add failing projection tests

**Files:**
- Test: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

- [ ] Add a ground-truth test with a completed Reviewer attempt whose TaskBundle
  round/SHA match the current proposal and assert the bounded feedback object.
- [ ] Add a dispatcher test asserting `spawn:proposer` receives
  `inputs.review_feedback` while excluding transcript content.
- [ ] Run:
  `npx vitest run src/orchestrator/__tests__/ground-truth.test.js src/orchestrator/__tests__/dispatcher.test.js`
  and verify the new assertions fail because the field is absent.

### Task 2: Implement the bounded handoff

**Files:**
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`

- [ ] Select the latest canonical completed Reviewer attempt with matching
  identity, status, `inputs.contract_round`, and `inputs.contract_sha`.
- [ ] Project only `attempt_id`, `contract_round`, `contract_sha`, `summary`, and
  `reason`; sanitize and cap each text field at 2,000 characters.
- [ ] Copy the projection into Proposer inputs.
- [ ] Re-run the two focused test files and verify green.

### Task 3: Version and verify

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: repository lockfile if required by version synchronization

- [ ] Bump Brain from `1.267.160` to `1.267.161`.
- [ ] Document the feedback handoff and fail-closed anchoring in `DEFINITION.md`.
- [ ] Run the focused orchestrator suite and Brain contract checks.
- [ ] Run DevGate.
- [ ] Commit, push the feature branch, open a PR, repair CI, and merge only after
  all required checks are green.
