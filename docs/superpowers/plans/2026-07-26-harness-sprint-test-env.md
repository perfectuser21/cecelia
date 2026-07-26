# Harness Sprint Test Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Harness v5 sprint contracts an isolated PostgreSQL database, complete connection settings, and the immutable PR base SHA.

**Architecture:** The existing Brain server and smoke seed continue using the `cecelia` service database. A dedicated workflow step creates `cecelia_test`, and only the sprint Vitest step receives the safe test URL, discrete Brain DB settings, and pull-request base SHA.

**Tech Stack:** GitHub Actions YAML, PostgreSQL CLI, Vitest, TypeScript

---

### Task 1: Freeze the runner environment contract

**Files:**
- Modify: `packages/engine/tests/skills/harness-v5-ci-checks.test.ts`

- [ ] **Step 1: Write the failing regression**

Add a test that extracts the `tests-actually-pass` job and requires all of the
following literal workflow contracts:

```ts
it('Sprint Tests 使用隔离 test DB、完整连接参数与 PR base SHA', () => {
  expect(workflow).toMatch(/- name: Create isolated sprint test database[\s\S]*?run:\s*createdb cecelia_test/);
  expect(workflow).toContain('TEST_DATABASE_URL: postgresql://cecelia:cecelia@localhost:5432/cecelia_test');
  expect(workflow).toContain('DB_HOST: localhost');
  expect(workflow).toContain("DB_PORT: '5432'");
  expect(workflow).toContain('DB_NAME: cecelia_test');
  expect(workflow).toContain('DB_USER: cecelia');
  expect(workflow).toContain('DB_PASSWORD: cecelia');
  expect(workflow).toContain('CONTRACT_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
});
```

- [ ] **Step 2: Run the test and verify Red**

Run:

```bash
npm test -w packages/engine -- tests/skills/harness-v5-ci-checks.test.ts --reporter=verbose
```

Expected: one new test fails because the current workflow neither creates
`cecelia_test` nor injects the required environment.

### Task 2: Provide the isolated sprint-test environment

**Files:**
- Modify: `.github/workflows/harness-v5-checks.yml`

- [ ] **Step 1: Create the test database**

Insert this step after Brain migrations and before the Brain server starts:

```yaml
      - name: Create isolated sprint test database
        if: steps.check-tests.outputs.has_tests == 'true'
        env:
          PGHOST: localhost
          PGPORT: '5432'
          PGUSER: cecelia
          PGPASSWORD: cecelia
        run: createdb cecelia_test
```

- [ ] **Step 2: Inject the complete test environment**

Extend the `Run sprint tests` environment with:

```yaml
          TEST_DATABASE_URL: postgresql://cecelia:cecelia@localhost:5432/cecelia_test
          DB_HOST: localhost
          DB_PORT: '5432'
          DB_NAME: cecelia_test
          DB_USER: cecelia
          DB_PASSWORD: cecelia
          CONTRACT_BASE_SHA: ${{ github.event.pull_request.base.sha }}
```

- [ ] **Step 3: Run the focused regression and verify Green**

Run:

```bash
npm test -w packages/engine -- tests/skills/harness-v5-ci-checks.test.ts --reporter=verbose
```

Expected: 13 tests pass with zero failures.

- [ ] **Step 4: Validate YAML and diff hygiene**

Run:

```bash
node -e "const fs=require('fs');const YAML=require('yaml');YAML.parse(fs.readFileSync('.github/workflows/harness-v5-checks.yml','utf8'));"
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the hotfix**

```bash
git add .github/workflows/harness-v5-checks.yml packages/engine/tests/skills/harness-v5-ci-checks.test.ts docs/superpowers/plans/2026-07-26-harness-sprint-test-env.md
git commit -m "fix: isolate Harness sprint test database"
```

### Task 3: Publish the draft PR

**Files:**
- Verify only; no new files

- [ ] **Step 1: Re-run focused verification**

```bash
npm test -w packages/engine -- tests/skills/harness-v5-ci-checks.test.ts --reporter=verbose
git diff --check origin/main...HEAD
git status -sb
```

Expected: 13 tests pass, diff check exits 0, and the worktree is clean.

- [ ] **Step 2: Push and open a draft PR**

Push `agent/fix-harness-sprint-test-env` to `origin`, then open a draft PR
against `main` describing the #4343 Sprint Tests root cause, the fail-closed
database isolation, and the focused regression evidence.
