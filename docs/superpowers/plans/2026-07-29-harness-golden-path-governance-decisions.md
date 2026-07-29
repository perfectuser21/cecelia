# Harness Golden Path Governance Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Harness Golden Path 定版治理裁决写入 decisions SSOT，并让高风险 global invariant 被所有 Harness line 继承。

**Architecture:** Migration 370 扩展既有 decisions level 枚举并按稳定 source_ref 幂等写入六条机器可读裁决；现有 harness-line-context 增加 global invariant 读取，不新增平行政策表。确定性人工 Gate 留给后续 GP 合同层，本切片只完成裁决 SSOT 与上下文继承。

**Tech Stack:** PostgreSQL migrations、Node.js ESM、Vitest、Cecelia Brain

---

### Task 1: Governance migration contract Red

**Files:**
- Create: `packages/brain/src/__tests__/migration-370-gp-governance-decisions.test.js`
- Create: `packages/brain/migrations/370_gp_governance_decisions.sql`

- [ ] **Step 1: Write the failing migration contract test**

测试读取 migration 370，断言：

```js
expect(sql).toContain("policy_version");
expect(sql).toContain("gp.sealing.element-criterion");
expect(sql).toContain("gp.sealing.contract-criterion");
expect(sql).toContain("gp.sealing.rejection-template");
expect(sql).toContain("gp.ownership-transfer.b");
expect(sql).toContain("gp.high-risk.global-invariant");
expect(sql).toContain("gp.classification-and-yield-defaults");
expect(sql).toMatch(/level[^;]+global/s);
expect(sql).toContain("harness-gp-governance-prd:");
expect(sql).toContain("ON CONFLICT");
```

- [ ] **Step 2: Run the test and verify Red**

Run:

```bash
npx vitest run src/__tests__/migration-370-gp-governance-decisions.test.js
```

from `packages/brain`.

Expected: FAIL because `370_gp_governance_decisions.sql` does not exist.

- [ ] **Step 3: Implement migration 370**

Migration must:

```sql
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_level_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_level_chk
  CHECK (level IS NULL OR level IN ('global','area','ability','feature','step'));
```

Create a unique partial index limited to
`source_ref LIKE 'harness-gp-governance-prd:%'`, then insert the six fixed policies
with `context.policy_key`, `context.policy_version=1`, their structured rule payload, Owner
attribution, and the matching partial-index `ON CONFLICT` predicate. This must not impose
uniqueness on historical non-governance `source_ref` values.

- [ ] **Step 4: Run the migration contract test and verify Green**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit migration slice**

```bash
git add packages/brain/migrations/370_gp_governance_decisions.sql packages/brain/src/__tests__/migration-370-gp-governance-decisions.test.js
git commit -m "feat(brain): seed finalized Golden Path governance decisions"
```

### Task 2: Global invariant inheritance Red → Green

**Files:**
- Modify: `packages/brain/src/__tests__/harness-line-context.test.js`
- Modify: `packages/brain/src/harness-line-context.js`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Extend the test pool and write failing global tests**

Return both `global` and `area` rows from the level query and assert:

```js
expect(findCall(pool, /level IN \\('global','area'\\)/)).toBeTruthy();
expect(result.invariants.find((d) => d.id === 'global-risk').source_level).toBe('global');
expect(result.invariants.find((d) => d.id === 'area-rule').source_level).toBe('area');
```

Also format a global invariant and assert the prompt includes `来源: global`.

- [ ] **Step 2: Run line-context test and verify Red**

```bash
npx vitest run src/__tests__/harness-line-context.test.js
```

Expected: FAIL because only area invariants are queried and no global source exists.

- [ ] **Step 3: Implement global + area reading**

Replace the single area query with one query:

```sql
SELECT * FROM decisions
WHERE category='invariant' AND status='active'
  AND level IN ('global','area')
ORDER BY CASE level WHEN 'global' THEN 0 ELSE 1 END, created_at DESC
```

Split returned rows by `row.level`, then merge step → journey_feature → global → area while
preserving id de-duplication.

- [ ] **Step 4: Update Brain version and definition**

Bump `packages/brain/package.json` to `1.267.131`. Set the same version in
`packages/brain/DEFINITION.md` and add a top section describing finalized governance decisions,
global invariant inheritance, scope, and rollback.

- [ ] **Step 5: Verify Green and focused regression**

```bash
npx vitest run src/__tests__/harness-line-context.test.js src/__tests__/invariant-gate.test.js src/__tests__/migration-370-gp-governance-decisions.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit runtime slice**

```bash
git add packages/brain/src/harness-line-context.js packages/brain/src/__tests__/harness-line-context.test.js packages/brain/package.json packages/brain/DEFINITION.md
git commit -m "feat(brain): inherit global Golden Path invariants"
```

### Task 3: Migration execution and verification

**Files:**
- Modify: `packages/brain/src/__tests__/migration-370-gp-governance-decisions.test.js`

- [ ] **Step 1: Apply migration to a disposable PostgreSQL transaction**

Create temporary `decisions` and `schema_version` tables in a test transaction, set
`search_path=pg_temp,public`, execute migration 370 twice, and verify:

```sql
SELECT context->>'policy_key', COUNT(*)
FROM decisions
GROUP BY 1
ORDER BY 1;
```

Expected: six rows and every count equals 1.

- [ ] **Step 2: Verify the global invariant payload**

Query `gp.high-risk.global-invariant` and assert:

- `category=invariant`
- `level=global`
- domains exactly equal permission, money, external_publish, production_data
- action equals require_human_confirmation

- [ ] **Step 3: Run Brain full test suite**

```bash
npm test -w packages/brain
```

Expected: PASS with zero failed tests.

- [ ] **Step 4: Run DevGate**

Run:

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node scripts/devgate/check-contract-drift.mjs --base=origin/main
```

Expected: all three commands exit 0.

- [ ] **Step 5: Commit any test-only corrections**

```bash
git add packages/brain/src/__tests__/migration-370-gp-governance-decisions.test.js
git commit -m "test(brain): verify governance decision migration idempotency"
```

### Task 4: Review and delivery

**Files:**
- Review all files changed since `origin/main`

- [ ] **Step 1: Inspect scope**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Expected: only migration 370, governance tests, line-context, Brain version/definition, and
the approved design/plan documents.

- [ ] **Step 2: Verify no later PRD phase leaked in**

Confirm the diff contains no GP contract/signature tables, assertion verification tables,
retirement jobs, incident corpus, or acceptance UI changes.

- [ ] **Step 3: Run final focused and full verification**

Re-run focused tests, Brain full tests, and DevGate from a clean worktree. Record exact outputs
for the PR handoff.

- [ ] **Step 4: Prepare `/dev` delivery**

Use the repository `/dev` workflow to create the PR; do not push `main`. Merge only after the
latest CI checks pass and the requested review workflow completes.
