# Migration 359 Legacy Conversations Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make migration 359 safely preserve a production-shaped legacy `conversations` table and create the new conversation schema.

**Architecture:** A transaction-safe `DO` block classifies the current table by the `journey_id` discriminator, renames incompatible legacy data to a deterministic backup, and fails closed on an ambiguous backup collision. A true PostgreSQL integration test executes the real SQL in a unique schema so it reproduces production shape without mutating shared tables.

**Tech Stack:** PostgreSQL PL/pgSQL, Node.js, Vitest, `pg`, Git/GitHub Actions.

---

### Task 1: Reproduce the production-shaped collision

**Files:**
- Create: `packages/brain/src/__tests__/integration/migration-359-legacy-conversations.integration.test.js`

- [ ] **Step 1: Write the failing true-PostgreSQL test**

Create a Vitest test that reads `packages/brain/migrations/359_conversations.sql`, connects with `DB_DEFAULTS`, refuses a database name that does not end in `_test` or `_scratch`, creates a unique schema, and uses a checked-out client with:

```sql
SET search_path TO "<unique_schema>", public;
CREATE TABLE journeys (id UUID PRIMARY KEY);
CREATE TABLE golden_path (id UUID PRIMARY KEY);
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  mode TEXT,
  topic TEXT,
  summary TEXT,
  key_points JSONB,
  action_items JSONB,
  area TEXT,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  area_id UUID
);
```

Insert a known legacy row, execute the migration inside a transaction, capture any error, and assert the error is `null`. Then assert the new table contains `journey_id`, the backup contains the known row, and the primary-key constraints are distinct. Execute the migration a second time and assert success.

Add a second case that creates both an incompatible `conversations` table and `conversations_legacy_pre_359`, executes the migration in a transaction, and expects the explicit ambiguity error without row loss.

- [ ] **Step 2: Run the test and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/integration/migration-359-legacy-conversations.integration.test.js --reporter=verbose
```

Expected: the preservation case fails an assertion because current migration 359 raises `column "journey_id" does not exist`; the collision-guard case also lacks the required deterministic error.

- [ ] **Step 3: Commit the Red test**

```bash
git add packages/brain/src/__tests__/integration/migration-359-legacy-conversations.integration.test.js
git commit -m "test(brain): reproduce migration 359 legacy collision (Red)"
```

### Task 2: Preserve legacy data and fail closed

**Files:**
- Modify: `packages/brain/migrations/359_conversations.sql`
- Test: `packages/brain/src/__tests__/integration/migration-359-legacy-conversations.integration.test.js`

- [ ] **Step 1: Add the minimal migration guard**

Prepend a `DO` block that:

```sql
DO $migration$
DECLARE
  conversations_exists BOOLEAN;
  has_journey_id BOOLEAN;
  backup_exists BOOLEAN;
BEGIN
  SELECT to_regclass(format('%I.conversations', current_schema())) IS NOT NULL
    INTO conversations_exists;
  SELECT to_regclass(format('%I.conversations_legacy_pre_359', current_schema())) IS NOT NULL
    INTO backup_exists;

  IF conversations_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversations'
        AND column_name = 'journey_id'
    ) INTO has_journey_id;

    IF NOT has_journey_id THEN
      IF backup_exists THEN
        RAISE EXCEPTION
          'migration 359: incompatible conversations and conversations_legacy_pre_359 both exist';
      END IF;

      EXECUTE format(
        'ALTER TABLE %I.conversations RENAME TO conversations_legacy_pre_359',
        current_schema()
      );

      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = current_schema()
          AND t.relname = 'conversations_legacy_pre_359'
          AND c.conname = 'conversations_pkey'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.conversations_legacy_pre_359 RENAME CONSTRAINT conversations_pkey TO conversations_legacy_pre_359_pkey',
          current_schema()
        );
      END IF;
    END IF;
  END IF;
END
$migration$;
```

- [ ] **Step 2: Run the focused integration test and verify Green**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/integration/migration-359-legacy-conversations.integration.test.js --reporter=verbose
```

Expected: both tests pass against real PostgreSQL.

- [ ] **Step 3: Run adjacent conversation tests**

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/conversations.test.js src/__tests__/integration/migration-359-legacy-conversations.integration.test.js --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 4: Commit the Green implementation**

```bash
git add packages/brain/migrations/359_conversations.sql
git commit -m "fix(brain): preserve legacy conversations in migration 359 (Green)"
```

### Task 3: Bump Brain version and run repository gates

**Files:**
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Bump Brain from 1.267.59 to 1.267.60**

Update all Brain version sources together and verify:

```bash
bash scripts/verify-brain-version.sh
```

Expected: version sources agree on `1.267.60`.

- [ ] **Step 2: Run focused tests from a fresh command**

```bash
cd packages/brain
npx vitest run src/__tests__/integration/migration-359-legacy-conversations.integration.test.js src/routes/__tests__/conversations.test.js --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 3: Run DevGate/pre-push verification**

```bash
bash scripts/devgate/pre-push.sh
```

Expected: exit 0. If the repository exposes a different canonical pre-push entrypoint, use the entrypoint printed by the script and record the exact result.

- [ ] **Step 4: Commit the synchronized version**

```bash
git add .brain-versions DEFINITION.md packages/brain/package.json packages/brain/package-lock.json package-lock.json
git commit -m "chore(brain): bump version to 1.267.60"
```

### Task 4: Publish, validate, and merge the hotfix

**Files:**
- No additional source files.

- [ ] **Step 1: Review the final branch**

```bash
git status --short
git diff origin/main...HEAD --check
git log --oneline origin/main..HEAD
```

Expected: clean worktree, no whitespace errors, only design/plan, test, migration, and version changes.

- [ ] **Step 2: Push and open a ready PR targeting `main`**

```bash
git push -u origin agent/migration-359-legacy-conversations
gh pr create --base main --head agent/migration-359-legacy-conversations --title "fix(brain): preserve legacy conversations in migration 359" --body-file <prepared-body>
```

The body must include production root cause, Red→Green commands/results, data-preservation behavior, collision guard, and explicitly state that this is independent from PR #4226.

- [ ] **Step 3: Wait for GitHub check rollup**

Inspect every check and its failure log if needed. Expected: all required checks green or intentionally skipped.

- [ ] **Step 4: Merge the hotfix**

Merge through the repository's allowed GitHub mechanism only after checks are green. Confirm the merge commit is on `origin/main`.

### Task 5: Rebase PR #4226 operationally onto the fixed main

**Files:**
- Modify only the PR #4226 branch's version files if its Brain version no longer exceeds `main`.

- [ ] **Step 1: Update the #4226 worktree from the new main**

Fetch `origin/main`, integrate it using the branch's established update convention, and keep the migration hotfix as main history rather than reimplementing it in the kernel diff.

- [ ] **Step 2: Bump #4226 Brain version if necessary**

If hotfix main is `1.267.60`, advance #4226 to `1.267.61` across all synchronized version files and run `bash scripts/verify-brain-version.sh`.

- [ ] **Step 3: Rerun the #4226 focused verification**

Run the kernel relay pool, controlled Brain pool, true-PG kernel wiring 8/8, local precheck, and `git diff --check`. Expected: all focused evidence remains green.

- [ ] **Step 4: Push and wait for #4226 GitHub check rollup**

Expected: Deploy Preview Environment now passes migration 359 and all other checks remain green.

- [ ] **Step 5: Leave #4226 unmerged and update its handoff comment**

Record the new SHA, hotfix dependency/merge, Red→Green evidence, focused regression results, and check rollup. Stop for independent review; do not merge #4226.
