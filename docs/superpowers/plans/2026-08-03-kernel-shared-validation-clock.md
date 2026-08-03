# Kernel Shared Validation Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one Controller-owned validation clock and inject it unchanged into every Generator, Evaluator, and Judge Runner.

**Architecture:** A focused orchestrator helper resolves the earliest validation clock from append-only decision-log evidence or creates it at the first Generator intent. Dispatcher TaskBundles carry the clock, and the Fleet Worker validates and maps it to Runner environment variables. The existing automation deadline stays independent.

**Tech Stack:** Node.js ESM/CJS, PostgreSQL append-only decision log, Vitest, Docker/Fleet Worker.

---

### Task 1: Controller clock resolution

**Files:**
- Create: `packages/brain/src/orchestrator/validation-clock.js`
- Test: `packages/brain/src/orchestrator/__tests__/validation-clock.test.js`

- [ ] Write failing tests for first Generator creation, persisted-clock reuse, legacy `created_at` recovery, and malformed/missing inputs.
- [ ] Run `npx vitest run src/orchestrator/__tests__/validation-clock.test.js --reporter=dot` and confirm the missing module/behavior fails.
- [ ] Implement the minimal pure resolver with an exact positive timeout and ISO timestamps.
- [ ] Re-run the focused test and confirm all cases pass.

### Task 2: Decision-log and TaskBundle propagation

**Files:**
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/loop.test.js`

- [ ] Add Red assertions that first Generator intent records the clock and Generator/Evaluator/Judge TaskBundles all reuse it.
- [ ] Run the two focused suites and confirm failures show absent clock fields.
- [ ] Resolve the clock before intent append, include it in intent detail, and pass it to dispatcher.
- [ ] Copy the resolved clock only into validation-role TaskBundle inputs.
- [ ] Re-run focused suites and confirm Green.

### Task 3: Fleet Worker fail-closed environment injection

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Test: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`

- [ ] Add Red tests that exact TaskBundle timestamps become Runner env and invalid/missing validation clocks are rejected for validation roles.
- [ ] Run `npx vitest run scripts/fleet-worker/attempt-runner.test.cjs --reporter=dot` and confirm the new assertions fail.
- [ ] Validate the shared window and map it to `HARNESS_PIPELINE_STARTED_AT` / `HARNESS_DEADLINE_AT` without generating values.
- [ ] Re-run the suite and confirm Green.

### Task 4: Version, documentation, and regression verification

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/scripts/fleet-worker/node-probe.cjs`
- Modify: `packages/brain/DEFINITION.md`

- [ ] Increment Brain to `1.267.199` and Fleet Worker to `1.267.100`.
- [ ] Document ownership, recovery semantics, fail-closed behavior, rollback, and unchanged Runner digest.
- [ ] Run focused tests, Brain full tests, and relevant smoke/static checks.
- [ ] Commit intentionally, push a non-main branch, open a PR, fix CI, and merge only after required checks pass.
- [ ] Roll out Brain and Worker, inspect production versions and Runner env, answer the existing needs-context request, and resume the same Kernel run.

