# Kernel Wiring Evaluator Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:systematic-debugging task-by-task in this same Generator Mode 2 session.

**Goal:** Replace mock-only Kernel evidence with isolated real-PostgreSQL proofs, make approval concurrent-safe and rate-limited, and repair graduated contract commands.

**Architecture:** A permanent `*.pg.integration.test.js` suite creates a uniquely named database, applies the repository's real migrations, exercises production loop/callback/approval code, and drops the database in `afterAll`. PostgreSQL and production stores/routes remain unmocked; only GitHub, Docker, filesystem observation, and generator execution are boundary stubs. Approval writes become an advisory-lock transaction, while callback request storage resolves the Express-injected pool so the same production route can run against an isolated database.

**Tech Stack:** Node.js 22, Vitest, Express/Supertest, `pg`, PostgreSQL 15, `express-rate-limit`, GitHub Actions.

---

### Task 1: Permanent real-PostgreSQL regression suite

**Files:**
- Create: `packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`
- Modify: `.github/workflows/ci.yml`

- [ ] Add a database harness that generates a validated `kernel_wiring_*` name, runs `src/migrate.js`, and force-drops only that generated database.
- [ ] Add real `runLoop` restart cases proving persisted `BLOCKED`, `NEEDS_CONTEXT`, and `wait:poll_ci` rows are read by a second instance.
- [ ] Add real evaluator/judge writers and assert both failure classes survive before `collectGroundTruth`/`derive` routes by the judge class.
- [ ] Add real loop → production attempt store → HTTP callback → PostgreSQL → second collect/derive no-progress coverage.
- [ ] Add mounted approval route coverage for 401, stale SHA, legal approval, duplicate approval, concurrent duplicate approval, merge derivation, and burst 429.
- [ ] Run:
  `cd packages/brain && npx --no-install vitest run src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=verbose`
  and verify failures are assertion mismatches for callback pool binding, concurrent approval status, and missing 429.
- [ ] Commit the test and CI collection as `(Red)`.

### Task 2: Callback database boundary

**Files:**
- Modify: `packages/brain/src/routes/harness-callback.js`

- [ ] Resolve `req.app.get('pool') || pool` per callback request.
- [ ] Build the real attempt store from that database and pass the same database to verdict/callback writers and run updates.
- [ ] Re-run the PG suite and verify the no-progress callback case turns green without mocking DB, attempt store, or handler.

### Task 3: Atomic, rate-limited approval

**Files:**
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`

- [ ] Reuse `express-rate-limit` with the existing 60-second/10-request approval policy.
- [ ] Acquire a transaction-scoped advisory lock before duplicate check and append.
- [ ] Re-check duplicate state after the lock, append once, commit on success, and return 409 for the concurrent loser.
- [ ] Roll back and release the connection on every error path.
- [ ] Re-run the PG suite and verify concurrent statuses are exactly 202/409, one verdict row exists, and burst requests reach 429.
- [ ] Commit production changes as `(Green)`.

### Task 4: Graduated contract and PR evidence

**Files:**
- Modify: `sprints/07231527-relay-50170af2/contract-dod.md`
- Modify: `sprints/07231527-relay-50170af2/contract-draft.md`
- Modify: PR #4226 body

- [ ] Replace deleted sprint test paths with `../../tests/regression/relay-50170af2/*.test.js`.
- [ ] Use `npx --no-install vitest run` for every package-scoped Vitest command.
- [ ] Make E2E-1..4 independently executable from repository root using the real PG suite and strict Vitest exit codes.
- [ ] Replace weak curl status-only examples with `jq -e` response assertions.
- [ ] Add the no-mock boundary list for decision-log DB, loop/derive/dispatch/callback, and approval auth/mount/DB.
- [ ] Execute every contract command and record exit 0.
- [ ] Update PR Test plan and uncovered-boundary section, retaining only GitHub/Docker/generator outer-boundary stubs.

### Task 5: Verification and delivery

**Files:**
- Verify only; controller owns main synchronization and version bump.

- [ ] Run the new PG suite and query its evidence counts.
- [ ] Run the affected 194-test command and Kernel smoke.
- [ ] Run facts, current version sync, server syntax, pyramid, ratchet, TDD-order, and diff checks.
- [ ] Confirm frozen contract SHA256 values are unchanged.
- [ ] Push `cp-07231527-ws-50170af2` without creating or merging a PR.
