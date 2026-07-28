# Kernel Post-Diff Risk and Human Review Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-authoritative post-diff risk assessment and exact-proof human approval to the Kernel merge path.

**Architecture:** A pure risk-policy module derives a frozen proof from canonical PR diff, approved contract, prior production receipt and current green evidence. GroundTruth uses it for review routing; the approval route and merge boundary require the same exact proof bindings. Append-only migration 373 stores production receipts and assessments.

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL migrations, GitHub CLI JSON.

---

### Task 1: Pure post-diff risk policy

**Files:**
- Create: `packages/brain/src/orchestrator/post-diff-risk-policy.js`
- Create: `packages/brain/src/orchestrator/post-diff-risk-policy.test.js`

- [ ] Write tests for canonical diff hashing, protected path classes, caller-only elevation, first behavior, contract/path drift, expired proof, small-diff bounds, green-evidence requirements and exact receipt eligibility.
- [ ] Run `npx vitest run src/orchestrator/post-diff-risk-policy.test.js` and verify RED because the module is absent.
- [ ] Implement `assessPostDiffRisk()` with exact validation and fail-closed defaults.
- [ ] Re-run the test and verify GREEN.
- [ ] Commit the policy and tests.

### Task 2: GroundTruth and review derivation

**Files:**
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`

- [ ] Add failing tests that require GitHub `files` observation, server-side receipt lookup, post-diff proof materialization, mandatory review for uncertain data and auto eligibility only for an exact receipt.
- [ ] Run the two focused suites and verify the new assertions fail.
- [ ] Compute the proof in GroundTruth after the candidate PR and approved contract are known; expose effective review state to derive.
- [ ] Re-run both suites and verify GREEN.
- [ ] Commit GroundTruth and derivation wiring.

### Task 3: Exact proof approval and merge authority

**Files:**
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`
- Modify: `packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js`
- Modify: `packages/brain/src/orchestrator/merge-authority.js`
- Modify: `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
- Modify: `packages/brain/src/orchestrator/merge-effect-store.js`
- Modify: `packages/brain/src/orchestrator/merge-effect-executor.js`

- [ ] Add adversarial tests for stale diff hash, contract digest, policy version, task/run/hop and head SHA.
- [ ] Run the focused suites and verify RED.
- [ ] Store all proof bindings in review requests/verdicts and require exact parity at merge authorization.
- [ ] Load production proof data and persist the risk proof within merge authorization evidence.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit exact-proof authority changes.

### Task 4: Persistence, version and verification

**Files:**
- Create: `packages/brain/migrations/373_kernel_post_diff_risk_policy.sql`
- Create: `packages/brain/src/orchestrator/post-diff-risk-migration.test.js`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`

- [ ] Add a failing migration contract test for append-only receipt and assessment ledgers.
- [ ] Implement migration 373 and verify the migration test.
- [ ] Bump Brain from 1.268.2 to 1.268.3 and document the rollback target.
- [ ] Run focused Brain suites, ESLint, version sync, contract drift and `git diff --check`.
- [ ] Commit migration and version documentation.

