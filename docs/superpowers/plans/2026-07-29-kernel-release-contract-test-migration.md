# Kernel Release Contract Test Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two obsolete Gate3/tag-based deployment contracts with CI-enforced durable Kernel ReleaseRun exact-SHA and receipt-authority contracts.

**Architecture:** Keep both existing shell entrypoints so CI and Engine callers retain stable test surfaces. Rewrite their assertions around the production GitHub merge adapter, durable merge receipt, ReleaseRun state machine, staging/production receipts, rollback authority, and authorized workflow inputs; update the PR workflow to run the migrated contract with Node dependencies.

**Tech Stack:** Bash, GitHub Actions YAML, Node.js 22, Vitest, PostgreSQL-backed ReleaseRun ledgers.

---

### Task 1: Migrate the PR SHA-account contract

**Files:**
- Modify: `tests/regression/gate3-sha-truth/sha-account.test.sh`
- Modify: `.github/workflows/brain-ci-deploy.yml`

- [x] Rewrite the shell test to require the migrated `sha-account-l1` PR job, exact `release_run_id`/`merge_sha`/`release_authorization` forwarding, an authorized deploy request, and focused merge/ReleaseRun tests.
- [x] Run `bash tests/regression/gate3-sha-truth/sha-account.test.sh` before the workflow change and confirm it fails on the missing migrated job contract.
- [x] Provision the stable workflow job with Node 22 and `npm ci`, preserving the shell entrypoint.
- [x] Re-run the shell test and confirm all migrated assertions pass.

### Task 2: Migrate the Engine release/deploy-stage contract

**Files:**
- Modify: `packages/engine/tests/integration/release-deploy-stage.test.sh`

- [x] Replace tag/live/current assertions with a mechanical mapping from the old stages to merge receipt, staging receipt, production receipt, `production_verified`, and rollback authority.
- [x] Require the same CI ReleaseRun authority job so the rewritten test is red before the workflow migration.
- [x] Run the shell test before the workflow change and confirm the expected migrated-job failure.
- [x] Re-run after the workflow migration and confirm the durable ReleaseRun contract passes.

### Task 3: Close formatting and verify

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-kernel-post-diff-review-policy.md`

- [x] Remove the blank line reported by `git diff --check`.
- [x] Run both shell contracts.
- [x] Run focused ReleaseRun, GitHub merge adapter, merge effect, store, and workflow tests.
- [x] Run workflow lint/precheck and `git diff --check`.
- [x] Commit the isolated branch and report the exact commit SHA.
