# Golden Path Contract Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist versioned seven-item GP contracts, bind Owner signatures to exact versions, and launch Harness only from the latest signed contract.

**Architecture:** Add one append-only GP contract-version table and a focused service module. Existing Golden Path routes delegate version and launch transactions to that module; the existing pending-actions executor signs and launches the latest version atomically. Skill snapshots are synced only after the SSOT PR merges.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, Zod 4, Vitest, Supertest, GitHub Actions.

---

## File map

- Create `packages/brain/migrations/372_golden_path_contract_versions.sql`: version/signature persistence.
- Create `packages/brain/src/golden-path-contracts.js`: schema, hashing, version, sign/launch transactions.
- Create `packages/brain/src/__tests__/golden-path-contracts.test.js`: service Red→Green.
- Create `packages/brain/src/__tests__/migration-372-golden-path-contracts.test.js`: migration contract.
- Create `packages/brain/src/__tests__/integration/golden-path-contract.integration.test.js`: real PostgreSQL lifecycle.
- Modify `packages/brain/src/routes/golden-paths.js`: GET/POST contracts and `/approve` hard Gate.
- Modify `packages/brain/src/routes/__tests__/golden-paths.test.js`: route behavior.
- Modify `packages/brain/src/decision-executor.js`: `sign_golden_path_contract` handler using current transaction.
- Modify `packages/brain/src/__tests__/decision-executor.test.js`: pending-action signing.
- Modify `scripts/sync-skills-snapshot.sh`: include mapper.
- Modify four `packages/workflows/skills/*/SKILL.md`: exact SSOT snapshots.
- Modify Brain version files and the implementation plan.

### Task C1: Add contract schema and hashing Red→Green

**Files:**
- Create: `packages/brain/src/__tests__/golden-path-contracts.test.js`
- Create: `packages/brain/src/golden-path-contracts.js`

- [ ] **Step 1: Write Red tests**

Define `VALID_CONTRACT` with exactly:

```js
const VALID_CONTRACT = {
  fr_summary: { statements: ['用户在入口提交后看到成功结果'] },
  lifelines_and_nfr: {
    items: [{
      statement: '写入必须唯一',
      class: 'lifeline',
      verification: 'SELECT COUNT(*) = 1',
      rationale: '重复写入即业务失败',
    }],
  },
  yield_order: {
    order: ['安全/资金正确性', '数据一致性', '功能完整', '性能', '体验顺滑'],
    override_reason: null,
  },
  external_commitment_changes: { changes: [], none: true },
  release_and_blast_radius: {
    stages: ['internal'],
    blast_radius: '单一内部 Journey',
    rollback_triggers: ['错误率 > 1%'],
  },
  success_and_close: {
    metrics: ['成功率 >= 99%'],
    observation_window: '24h',
    close_conditions: ['24h 达标'],
    shutdown_conditions: ['连续 5 分钟错误率 > 1%'],
  },
  budget_guard: {
    total_cost_cap_usd: 10,
    atom_cost_cap_usd: 2,
    atom_runtime_sec: 1800,
    atom_parallelism: 1,
  },
};
```

Test: valid passes; each missing key fails; extra top-level key fails; invalid NFR class fails; empty rollback fails; non-positive budget fails; reordered JSON has identical hash.

- [ ] **Step 2: Run Red**

```bash
npx vitest run src/__tests__/golden-path-contracts.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement schema and stable hash**

Export:

```js
import { createHash } from 'node:crypto';

export const GP_CONTRACT_SCHEMA_VERSION = 1;
export const GP_CONTRACT_KEYS = Object.freeze([
  'fr_summary',
  'lifelines_and_nfr',
  'yield_order',
  'external_commitment_changes',
  'release_and_blast_radius',
  'success_and_close',
  'budget_guard',
]);

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function validateGoldenPathContract(value) {
  return GoldenPathContractSchema.parse(value);
}

export function hashGoldenPathContract(value) {
  const parsed = validateGoldenPathContract(value);
  return createHash('sha256')
    .update(JSON.stringify(sortJson(parsed)))
    .digest('hex');
}
```

Use `z.object(...).strict()`, `z.enum(['lifeline', 'best_effort'])`, and positive number/int constraints.

- [ ] **Step 4: Run Green and commit**

```bash
npx vitest run src/__tests__/golden-path-contracts.test.js
git add packages/brain/src/golden-path-contracts.js packages/brain/src/__tests__/golden-path-contracts.test.js
git commit -m "feat(brain): validate seven-item GP contracts"
```

### Task C2: Add migration 372

**Files:**
- Create: `packages/brain/migrations/372_golden_path_contract_versions.sql`
- Create: `packages/brain/src/__tests__/migration-372-golden-path-contracts.test.js`

- [ ] **Step 1: Write migration Red test**

Assert the SQL contains the table, four statuses, both FKs, unique version, and partial unique signed index:

```js
expect(sql).toContain('CREATE TABLE IF NOT EXISTS golden_path_contract_versions');
expect(sql).toMatch(/UNIQUE\s*\(golden_path_id,\s*version\)/);
expect(sql).toContain("WHERE status = 'signed'");
expect(sql).toContain("VALUES ('372'");
```

- [ ] **Step 2: Run Red**

Expected: ENOENT for migration 372.

- [ ] **Step 3: Write the migration**

Create columns from design §6. Add:

```sql
CREATE UNIQUE INDEX uq_gp_contract_one_signed
  ON golden_path_contract_versions(golden_path_id)
  WHERE status = 'signed';
```

Do not add a unique content-hash index; reverting to an old payload must create a newer version.

- [ ] **Step 4: Run Green and commit**

```bash
npx vitest run src/__tests__/migration-372-golden-path-contracts.test.js
git add packages/brain/migrations/372_golden_path_contract_versions.sql packages/brain/src/__tests__/migration-372-golden-path-contracts.test.js
git commit -m "feat(brain): persist GP contract versions"
```

### Task C3: Create version transaction and routes

**Files:**
- Modify: `packages/brain/src/golden-path-contracts.js`
- Modify: `packages/brain/src/__tests__/golden-path-contracts.test.js`
- Modify: `packages/brain/src/routes/golden-paths.js`
- Modify: `packages/brain/src/routes/__tests__/golden-paths.test.js`

- [ ] **Step 1: Write Red service tests**

Cover:

```text
missing journey_id → GP_LEDGER_ANCHOR_REQUIRED
same latest hash → same version and no pending action
signed v1 + changed payload → v1 invalidated, v2 pending, action created
pending v1 + changed payload → v1 superseded
dispatched/in_progress task → GP_CONTRACT_IN_FLIGHT
queued/blocked task → cancelled before v2
```

Use a stateful fake DB that records SQL and transaction order; do not assert only mock call counts.

- [ ] **Step 2: Run Red**

Expected: `createGoldenPathContractVersion` missing.

- [ ] **Step 3: Implement service**

Export `createGoldenPathContractVersion(db, { goldenPathId, contract })`.

Return:

```js
{
  contract_version: row,
  pending_action_id: row.signing_action_id,
  idempotent: false,
}
```

Use `SELECT ... FROM golden_paths WHERE id=$1 FOR UPDATE`, `MAX(version)`, and one DB transaction supplied by the caller.

- [ ] **Step 4: Write route Red tests**

Add:

```text
GET /golden-paths/:id/contracts → ordered versions
POST valid → 201 + pending_action_id
POST invalid → 400 GP_CONTRACT_INVALID
missing GP → 404 GP_NOT_FOUND
service conflict → matching 409 code
```

- [ ] **Step 5: Implement routes**

Add `withTransaction(pool, fn)` locally or in the service. POST body shape is `{ contract: <seven-item-object> }`; controller may also send the object directly only if the route normalizes it explicitly.

- [ ] **Step 6: Run Green and commit**

```bash
npx vitest run src/__tests__/golden-path-contracts.test.js src/routes/__tests__/golden-paths.test.js
git add packages/brain/src/golden-path-contracts.js packages/brain/src/__tests__/golden-path-contracts.test.js packages/brain/src/routes/golden-paths.js packages/brain/src/routes/__tests__/golden-paths.test.js
git commit -m "feat(brain): version GP contracts and queue signatures"
```

### Task C4: Sign once and launch once

**Files:**
- Modify: `packages/brain/src/golden-path-contracts.js`
- Modify: `packages/brain/src/__tests__/golden-path-contracts.test.js`
- Modify: `packages/brain/src/decision-executor.js`
- Modify: `packages/brain/src/__tests__/decision-executor.test.js`
- Modify: `packages/brain/src/routes/golden-paths.js`
- Modify: `packages/brain/src/routes/__tests__/golden-paths.test.js`

- [ ] **Step 1: Write signing Red tests**

Cover exact behavior:

```text
old version approval → GP_CONTRACT_STALE and no decision/task
latest pending version → decision + signed row + one harness task
task payload → gp_contract_id/version/hash
same signed version retry → same task id
no latest signed contract /approve → GP_CONTRACT_SIGNATURE_REQUIRED
any failure → transaction rollback
```

- [ ] **Step 2: Add shared signing/launch service**

Export these exact interfaces:

```ts
declare function signAndLaunchGoldenPathContract(
  db: DatabaseClient,
  args: { goldenPathId: string; version: number; reviewer: string },
): Promise<{ contract_version: ContractVersion; task: Task; idempotent: boolean }>;

declare function launchLatestSignedGoldenPath(
  db: DatabaseClient,
  args: { goldenPathId: string; expectedVersion?: number },
): Promise<{ contract_version: ContractVersion; task: Task; idempotent: boolean }>;
```

Reuse the existing task payload fields and add the three `gp_contract_*` fields. Query `tasks.payload->>'gp_contract_id'` before insert to make retry idempotent.

- [ ] **Step 3: Add pending-action handler with transaction injection**

Define:

```js
actionHandlers.sign_golden_path_contract = async (params, context, db = pool) =>
  signAndLaunchGoldenPathContract(db, {
    goldenPathId: params.golden_path_id,
    version: Number(params.version),
    reviewer: context.approved_by,
  });
```

Pass the current `client` as the third argument from `approvePendingAction`, `selectProposalOption`, and normal `executeDecision`; existing handlers ignore it.

- [ ] **Step 4: Replace route-local approval SQL**

`POST /golden-paths/:id/approve` calls `launchLatestSignedGoldenPath` inside a transaction and maps service error codes to 404/409.

- [ ] **Step 5: Run Green and commit**

```bash
npx vitest run src/__tests__/golden-path-contracts.test.js src/__tests__/decision-executor.test.js src/routes/__tests__/golden-paths.test.js
git add packages/brain/src/golden-path-contracts.js packages/brain/src/__tests__/golden-path-contracts.test.js packages/brain/src/decision-executor.js packages/brain/src/__tests__/decision-executor.test.js packages/brain/src/routes/golden-paths.js packages/brain/src/routes/__tests__/golden-paths.test.js
git commit -m "feat(brain): bind GP signatures to Harness launch"
```

### Task C5: Prove the real PostgreSQL lifecycle

**Files:**
- Create: `packages/brain/src/__tests__/integration/golden-path-contract.integration.test.js`

- [ ] **Step 1: Write Red integration flow**

Against migrated `cecelia_test`:

```text
create Journey + GP
POST contract v1
approve pending action → v1 signed + task1
POST changed contract → v1 invalidated + v2 pending
approve old action → stale
approve v2 action → v2 signed + task2 bound to v2 hash
```

Use real routes and DB reads; mock only external dispatch/network.

- [ ] **Step 2: Run Red, apply migration, run Green**

```bash
npx vitest run src/__tests__/integration/golden-path-contract.integration.test.js
```

Expected first failure: table missing. Apply migration through the repository’s test migration helper, not manual production SQL, then expect PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/integration/golden-path-contract.integration.test.js
git commit -m "test(brain): prove GP contract re-sign lifecycle"
```

### Task C6: Sync exact Skill SSOT

**Files:**
- Modify: `scripts/sync-skills-snapshot.sh`
- Modify/Create:
  - `packages/workflows/skills/golden-path-proposer/SKILL.md`
  - `packages/workflows/skills/golden-path-reviewer/SKILL.md`
  - `packages/workflows/skills/golden-path-mapper/SKILL.md`
  - `packages/workflows/skills/golden-path-controller/SKILL.md`
- Add a snapshot guard test under `packages/brain/src/__tests__/`.

- [ ] **Step 1: Write Red snapshot test**

Assert mapper is in `SKILLS=(...)`, all four snapshot files exist, and each version equals the PR-S merge content.

- [ ] **Step 2: Add mapper and run sync from the merged SSOT checkout**

```bash
SKILLS_SSOT_DIR=/Users/administrator/perfect21/zenithjoy-skills \
  bash scripts/sync-skills-snapshot.sh
```

Never hand-edit the four snapshot files.

- [ ] **Step 3: Run snapshot and GP wiring tests**

```bash
npx vitest run src/__tests__/golden-path-skill-snapshot.test.js src/__tests__/golden-path-proposal-wiring.test.js
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-skills-snapshot.sh packages/workflows/skills/golden-path-*
git commit -m "chore(skills): sync GP contract skills from SSOT"
```

### Task C7: Version, definition, and final verification

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `docs/superpowers/plans/2026-07-30-golden-path-contract-brain.md`

- [ ] **Step 1: Bump Brain patch version**

Increment from the current `origin/main` version at implementation time. Update `DEFINITION.md` with:

```text
GP contract schema v1
latest-version signature semantics
automatic invalidation/re-sign
Harness payload binding
rollback and failure codes
§③/§④ explicitly not included
```

- [ ] **Step 2: Run focused verification**

```bash
npx vitest run \
  src/__tests__/golden-path-contracts.test.js \
  src/__tests__/migration-372-golden-path-contracts.test.js \
  src/__tests__/decision-executor.test.js \
  src/routes/__tests__/golden-paths.test.js \
  src/__tests__/golden-path-proposal-wiring.test.js \
  src/__tests__/integration/golden-path-contract.integration.test.js
```

Expected: all pass, no unhandled warnings.

- [ ] **Step 3: Run repository gates**

Run the repository’s required quickcheck/DevGate commands, then:

```bash
git diff origin/main...HEAD --check
git status --short
```

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/DEFINITION.md docs/superpowers/plans/2026-07-30-golden-path-contract-brain.md
git commit -m "docs(brain): define GP contract layer"
```

### Task C8: Publish, repair CI, and merge PR-C

- [ ] **Step 1: Push and open PR**

Title:

```text
feat(brain): enforce versioned Golden Path contracts
```

PR body includes PR-S dependency/merge SHA, Red evidence, real PostgreSQL lifecycle evidence, and non-goals.

- [ ] **Step 2: Watch latest-SHA required checks**

Use the GitHub CI workflow. Any failure is diagnosed from logs, fixed with a new Red reproduction where applicable, and pushed to the same branch.

- [ ] **Step 3: Squash merge only after latest required checks pass**

After merge, verify production Brain version/health and migration 372, demonstrate v1 sign → change → invalidate → v2 re-sign in the accepted environment, report new PRD completion, and hand off §③. Stop before §③ implementation.
