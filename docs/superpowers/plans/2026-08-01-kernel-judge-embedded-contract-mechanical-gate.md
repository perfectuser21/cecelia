# Kernel Judge Embedded Contract Mechanical Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent path-free Fleet Judge attempts from falsely reporting `contract_tests=0` when their approved embedded contract contains concrete behavior tests.

**Architecture:** Preserve the provider-neutral path-free TaskBundle. Teach the existing mechanical gate to count concrete `[BEHAVIOR]` lines in `ctx.contractText`, while retaining filesystem scanning only as a legacy fallback.

**Tech Stack:** Node.js ESM, Vitest, Brain Kernel Judge.

---

### Task 1: Add the failing provider-neutral regression

**Files:**
- Modify: `packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js`

- [ ] **Step 1: Add a test that passes no host worktree and supplies an embedded concrete `[BEHAVIOR]` contract.**
- [ ] **Step 2: Run `npx vitest run src/__tests__/harness-judge-mechanical-gate.test.js` from `packages/brain` and verify it fails only with `contract_tests=0`.**

### Task 2: Count embedded locked-contract behavior entries

**Files:**
- Modify: `packages/brain/src/harness-judge.js`

- [ ] **Step 1: Reuse the existing concrete `[BEHAVIOR]` line grammar for `ctx.contractText`.**
- [ ] **Step 2: Use host Sprint files only when neither test files nor embedded concrete behavior entries are present.**
- [ ] **Step 3: Rerun the targeted test and verify all cases pass.**

### Task 3: Version, document, and verify

**Files:**
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Bump Brain from `1.267.164` to `1.267.165` and document behavior plus rollback.**
- [ ] **Step 2: Run the Kernel handler and Judge mechanical suites.**
- [ ] **Step 3: Run Brain lint and the relevant full Brain test suite required by DevGate.**
- [ ] **Step 4: Commit, push the branch, open the PR, wait for all checks, squash merge, and deploy the exact merge SHA with tick remaining manually disabled.**
