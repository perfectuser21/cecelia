# Kernel Harness PR2 Exact Run API and Trust Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every initiative-addressed `initiative_runs` mutation, migrate Controller callers to authoritative `run_id`, and classify historical runs without guessing.

**Architecture:** Add migration 376 for trust and recovery lineage, then make exact run reads and writes the only canonical API. Legacy initiative mutation becomes a fail-closed adapter that first resolves exactly one candidate and records a deprecation event. Both watchdogs mutate the selected row by `run.id`; a pure trust classifier and dry-run CLI produce deterministic reconstruction proposals while metrics keep trusted, reconstructed, and untrusted denominators separate.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, Vitest, Supertest, Cecelia migration runner, `zenithjoy-skills` Controller SSOT.

---

## File map

| File | Responsibility |
|---|---|
| `packages/brain/migrations/376_kernel_run_trust.sql` | Add trust status/reason and recovery lineage fields without rewriting history |
| `packages/brain/src/orchestrator/kernel-run-store.js` | Exact run lookup and exact progress/terminal mutation authority |
| `packages/brain/src/routes/initiatives.js` | Exact GET/PATCH, deterministic initiative history, fail-closed legacy adapter |
| `packages/brain/src/harness-watchdog.js` | Update the exact overdue row selected by the scan |
| `packages/brain/src/harness-relay-watchdog.js` | Update the exact selected relay run, never every run for an initiative |
| `packages/brain/src/orchestrator/run-trust-classifier.js` | Pure evidence-to-trust classification |
| `packages/brain/scripts/kernel-run-trust-reconcile.mjs` | Dry-run-by-default report and guarded apply entry point |
| `packages/brain/src/__tests__/integration/relay-run-exact-api.integration.test.js` | Real PostgreSQL R1 proof: 25 rows, one exact mutation |
| `packages/brain/scripts/smoke/kernel-run-exact-api-smoke.sh` | Permanent CI smoke for the PR2 contract |
| `packages/brain/DEFINITION.md` and version files | Brain contract/version/schema synchronization |

The `zenithjoy-skills` Controller change is a separate repository PR after this Cecelia compatibility API is merged. Callback convergence remains PR3; production apply and real business acceptance remain PR4.

---

### Task 1: Lock migration 376 and trusted canonical inserts

**Files:**

- Create: `packages/brain/src/__tests__/migration-376-kernel-run-trust.test.js`
- Create: `packages/brain/src/__tests__/integration/migration-376-kernel-run-trust.integration.test.js`
- Create after Red: `packages/brain/migrations/376_kernel_run_trust.sql`
- Modify after Red: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`

- [ ] **Step 1: Write migration and canonical-insert Red tests**

The source and real PostgreSQL tests require:

```sql
record_trust_status TEXT NOT NULL DEFAULT 'untrusted'
record_trust_reason TEXT
predecessor_run_id UUID REFERENCES initiative_runs(id)
```

with `record_trust_status IN ('trusted','reconstructed','untrusted')`. The store test requires canonical INSERT to name `record_trust_status` and pass `trusted`.

- [ ] **Step 2: Run Red**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-376-kernel-run-trust.test.js \
  src/__tests__/integration/migration-376-kernel-run-trust.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js
```

Expected: FAIL because migration 376 and trusted insert behavior do not exist.

- [ ] **Step 3: Implement migration and trusted insert**

Migration is additive, contains no manual transaction, leaves all historical rows `untrusted`, and adds the predecessor index. `createKernelRun()` explicitly inserts `record_trust_status='trusted'`; it never upgrades existing history.

- [ ] **Step 4: Run Green and commit**

```bash
npx vitest run \
  src/__tests__/migration-376-kernel-run-trust.test.js \
  src/__tests__/integration/migration-376-kernel-run-trust.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js
git commit -m "feat(kernel): add run trust lineage schema"
```

---

### Task 2: Add exact GET/PATCH and deterministic history

**Files:**

- Create: `packages/brain/src/__tests__/relay-runs-exact-api.test.js`
- Create: `packages/brain/src/__tests__/integration/relay-run-exact-api.integration.test.js`
- Modify after Red: `packages/brain/src/routes/initiatives.js`
- Modify after Red: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`

- [ ] **Step 1: Write Red contract tests**

Required API:

```text
GET   /api/brain/orchestrator/relay-runs/by-id/:run_id
PATCH /api/brain/orchestrator/relay-runs/by-id/:run_id
GET   /api/brain/orchestrator/relay-initiatives/:initiative_id/runs
```

Assertions:

```js
expect(updateSql).toMatch(/WHERE id\s*=\s*\$1[\s\S]+orchestrator_version\s*=\s*'v2'/i);
expect(updateSql).not.toMatch(/WHERE initiative_id/);
expect(historySql).toMatch(/ORDER BY started_at DESC,\s*id DESC/i);
```

The real PostgreSQL test inserts 25 terminal history rows for one initiative, patches one `run_id`, and byte-compares snapshots of the other 24.

- [ ] **Step 2: Run Red**

```bash
npx vitest run \
  src/__tests__/relay-runs-exact-api.test.js \
  src/__tests__/integration/relay-run-exact-api.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js
```

Expected: 404/missing export and R1 failure.

- [ ] **Step 3: Implement exact authority**

`loadKernelRunById()` selects exactly one v2 run. `patchKernelRunById()` validates phase and fields, locks task then run, updates by primary key, atomically terminalizes the parent task for `done/failed`, and appends one terminal decision event. Exact route validates UUID and returns 404 on zero rows.

- [ ] **Step 4: Implement deterministic history**

The history route is read-only and uses:

```sql
WHERE initiative_id=$1 AND orchestrator_version='v2'
ORDER BY started_at DESC, id DESC
```

- [ ] **Step 5: Run Green and commit**

```bash
npx vitest run \
  src/__tests__/relay-runs-exact-api.test.js \
  src/__tests__/integration/relay-run-exact-api.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js
git commit -m "feat(kernel): add exact run read and mutation API"
```

---

### Task 3: Make legacy mutation fail closed and observable

**Files:**

- Create: `packages/brain/src/__tests__/relay-runs-legacy-adapter.test.js`
- Modify after Red: `packages/brain/src/routes/initiatives.js`
- Replace obsolete expectations in:
  - `packages/brain/src/__tests__/relay-runs-patch-shortid.test.js`
  - `packages/brain/src/__tests__/relay-runs-verdict-writeback.test.js`

- [ ] **Step 1: Write Red tests**

For `PATCH /relay-runs/:initiative_id`:

```text
0 candidates -> 404
1 candidate  -> record cecelia_events deprecation event, delegate exact mutation
2+ candidates -> 409 ambiguous_legacy_run, no UPDATE
invalid/short ambiguous id -> 400/409 without guessing latest
```

The candidate query must return IDs only and must not use `LIMIT 1`.

- [ ] **Step 2: Run Red**

```bash
npx vitest run \
  src/__tests__/relay-runs-legacy-adapter.test.js \
  src/__tests__/relay-runs-patch-shortid.test.js \
  src/__tests__/relay-runs-verdict-writeback.test.js
```

Expected: legacy multi-row path still updates every row or chooses latest.

- [ ] **Step 3: Implement adapter and deprecation event**

Record:

```sql
INSERT INTO cecelia_events(event_type,source,payload)
VALUES('legacy_relay_mutation','relay-run-api',$1::jsonb)
```

Then delegate the one resolved `run_id` to the same exact store. The adapter response includes deprecation metadata and canonical `run_id`.

- [ ] **Step 4: Run Green and commit**

```bash
npx vitest run \
  src/__tests__/relay-runs-legacy-adapter.test.js \
  src/__tests__/relay-runs-patch-shortid.test.js \
  src/__tests__/relay-runs-verdict-writeback.test.js
git commit -m "fix(kernel): fail closed on legacy run mutation"
```

---

### Task 4: Convert watchdog mutations to `run.id`

**Files:**

- Modify first for Red:
  - `packages/brain/src/__tests__/harness-watchdog.test.js`
  - `packages/brain/src/__tests__/harness-relay-watchdog.test.js`
  - `packages/brain/src/__tests__/harness-relay-watchdog-gates.test.js`
- Modify after Red:
  - `packages/brain/src/harness-watchdog.js`
  - `packages/brain/src/harness-relay-watchdog.js`

- [ ] **Step 1: Write Red assertions**

Every `UPDATE initiative_runs` captured in watchdog tests must contain `WHERE id=$1`; the first parameter must be the selected row ID. `_finalizeMergedRun()` accepts `{ runId, taskId, initiativeId }`, never an initiative mutation key.

- [ ] **Step 2: Run Red**

```bash
npx vitest run \
  src/__tests__/harness-watchdog.test.js \
  src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-relay-watchdog-gates.test.js
```

Expected: assertions expose initiative-addressed updates.

- [ ] **Step 3: Implement exact watchdog writes**

Add `id` to overdue selectors, change every selected-row write to `WHERE id=$1`, and pass `run.id` through merged/PR/OOM/cap/housekeeping/tmux paths. Task updates continue to use the authoritative `current_task_id`.

- [ ] **Step 4: Run Green and repository scan**

```bash
npx vitest run \
  src/__tests__/harness-watchdog.test.js \
  src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-relay-watchdog-gates.test.js
rg -n -U "UPDATE initiative_runs[\\s\\S]{0,400}?WHERE initiative_id" \
  packages/brain/src/harness-watchdog.js \
  packages/brain/src/harness-relay-watchdog.js
```

Expected: tests PASS and `rg` returns no matches.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(kernel): target watchdog writes by run id"
```

---

### Task 5: Add deterministic trust classification and metrics

**Files:**

- Create: `packages/brain/src/orchestrator/run-trust-classifier.js`
- Create: `packages/brain/src/orchestrator/__tests__/run-trust-classifier.test.js`
- Create: `packages/brain/scripts/kernel-run-trust-reconcile.mjs`
- Create: `packages/brain/src/__tests__/kernel-run-trust-reconcile.test.js`
- Modify: `packages/brain/src/routes/initiatives.js`
- Modify: `packages/brain/src/__tests__/relay-runs-summary.test.js`

- [ ] **Step 1: Write Red classifier tests**

Rules:

```text
canonical trusted marker -> trusted
unique valid direct task reference -> reconstructed/direct_task_reference
unique attempt plus direct task reference -> reconstructed/direct_task_and_attempt
NULL task identity -> untrusted/missing_task_identity
missing task row -> untrusted/dangling_task_identity
duplicate/batch-collision evidence -> untrusted/batch_mutation_suspected
ambiguous evidence -> untrusted/ambiguous_identity
```

No rule may infer task identity from recency, UUID prefix, or initiative equality.

- [ ] **Step 2: Run Red**

```bash
npx vitest run \
  src/orchestrator/__tests__/run-trust-classifier.test.js \
  src/__tests__/kernel-run-trust-reconcile.test.js \
  src/__tests__/relay-runs-summary.test.js
```

- [ ] **Step 3: Implement pure classifier and dry-run CLI**

The CLI defaults to dry-run, prints JSON lines with `run_id`, before/after, reason, and evidence, writes no rows unless `--apply --audit-output <absolute-path>` are both supplied, updates in bounded transactions, and is idempotent.

- [ ] **Step 4: Separate metric denominators**

`relay-runs/summary` preserves legacy totals and adds:

```json
{
  "trust": {
    "trusted": 0,
    "reconstructed": 0,
    "untrusted": 0
  },
  "slo": {
    "trusted_total": 0,
    "trusted_done": 0,
    "trusted_success_rate": null
  }
}
```

Only native `trusted` rows enter `slo`.

- [ ] **Step 5: Run Green and commit**

```bash
npx vitest run \
  src/orchestrator/__tests__/run-trust-classifier.test.js \
  src/__tests__/kernel-run-trust-reconcile.test.js \
  src/__tests__/relay-runs-summary.test.js
git commit -m "feat(kernel): classify historical run trust"
```

---

### Task 6: Version, docs, smoke, full verification, PR

**Files:**

- Create: `packages/brain/scripts/smoke/kernel-run-exact-api-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/src/selfcheck.js`

- [ ] **Step 1: Write smoke Red and register it**

The smoke runs migration 376 source/integration tests, exact API tests, trust tests, and watchdog exactness tests. Run before registration/implementation and confirm failure.

- [ ] **Step 2: Update Brain version/schema/docs**

Increment Brain patch version, set schema floor 376, document exact mutation, trust denominators, legacy deprecation event, and dry-run policy.

- [ ] **Step 3: Run complete PR verification**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
cd packages/brain
npx vitest run \
  src/__tests__/relay-runs-*.test.js \
  src/__tests__/harness-watchdog.test.js \
  src/__tests__/harness-relay-watchdog*.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/orchestrator/__tests__/run-trust-classifier.test.js \
  src/__tests__/integration/migration-376-kernel-run-trust.integration.test.js \
  src/__tests__/integration/relay-run-exact-api.integration.test.js
bash scripts/smoke/kernel-run-exact-api-smoke.sh
```

- [ ] **Step 4: Independent review, push, CI, squash merge**

Fix all Critical/Important review findings, create the PR from the independent worktree, wait for all latest checks and Preview, squash merge without admin bypass, verify `origin/main`, and verify Preview cleanup.

---

## Cross-repository continuation after Cecelia PR2 merge

1. Create an independent `zenithjoy-skills` worktree from its latest `origin/main`.
2. Write Controller contract Red tests that require canonical run creation/lookup to persist `HARNESS_RUN_ID`.
3. Replace every relay GET/PATCH with `/relay-runs/by-id/${HARNESS_RUN_ID}` and use initiative history only for explicit reconstruction.
4. Version the skill, sync generated/distribution artifacts through that repository’s documented flow, pass its CI, and squash merge.
5. Observe production `cecelia_events.event_type='legacy_relay_mutation'`; once zero after the cutover window, make legacy PATCH return 410 in a small Cecelia closure PR.
6. Continue immediately to PR3 callback convergence.
