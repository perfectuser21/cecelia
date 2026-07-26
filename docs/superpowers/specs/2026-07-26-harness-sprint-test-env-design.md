# Harness Sprint Test Environment Design

## Problem

The Harness v5 `Sprint Tests 实跑` job starts PostgreSQL with only the
`cecelia` database and passes only `DB` to Vitest. Sprint contracts that
correctly fail closed without a dedicated test database therefore cannot run.
Nested Brain regressions also fall back to host and credential defaults that
are invalid on GitHub's Linux runner. Scope guards cannot compare the PR
against its contract base because the runner omits `CONTRACT_BASE_SHA`.

## Design

Keep the existing `cecelia` database, Brain server, migrations, and smoke seed
unchanged. Add a job step that creates a separate `cecelia_test` database for
contract tests. Inject the following values only into the sprint test step:

- `TEST_DATABASE_URL` pointing to `cecelia_test`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`
- `CONTRACT_BASE_SHA` from `github.event.pull_request.base.sha`

This preserves existing live-smoke behavior while giving both the PostgreSQL
contract and its nested Brain regression a safe, reachable database. The
production-database guard remains strict.

## Failure Handling

Database creation is a hard step: if `createdb` fails, the job stops before
running tests. Missing or invalid database variables remain visible as test
failures rather than falling back to the production-shaped `cecelia` database.
The base SHA comes directly from the pull-request event rather than being
computed from a mutable checkout.

## Regression Coverage

Extend the existing workflow-structure regression to require:

1. creation of `cecelia_test`;
2. the exact safe test URL;
3. all five discrete Brain database settings and password;
4. the pull-request base SHA expression.

The test must fail against the current workflow before the workflow is changed,
then pass after the minimal YAML update.
