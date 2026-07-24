# Migration 359 Legacy Conversations Hotfix Design

## Context

Migration `359_conversations.sql` assumes that the name `conversations` is free. Production already has a legacy `public.conversations` table with capture-era columns such as `mode`, `topic`, `summary`, and `session_date`. PostgreSQL therefore skips `CREATE TABLE IF NOT EXISTS conversations`, then fails while creating `idx_conversations_journey_id` because the legacy table has no `journey_id`.

This defect is already on `main` and breaks every preview that migrates a production-shaped database. It must ship as an independent hotfix PR to `main`; PR #4226 remains limited to kernel wiring.

## Requirements

1. Detect an existing `conversations` table that lacks the migration-359 discriminator column `journey_id`.
2. Preserve it by renaming it to `conversations_legacy_pre_359`.
3. Preserve its primary-key data structure without colliding with the new table's primary-key name.
4. Create the migration-359 `conversations` and `conversation_messages` tables and indexes after the rename.
5. Remain idempotent when migration 359 is executed again.
6. Fail closed if both an incompatible `conversations` table and `conversations_legacy_pre_359` already exist. Never overwrite or merge ambiguous data automatically.
7. Prove the behavior against real PostgreSQL using an isolated temporary schema with a production-shaped legacy row.

## Design

At the beginning of migration 359, a PostgreSQL `DO` block inspects `information_schema.columns` in `current_schema()`:

- If `conversations` does not exist, continue with the existing create statements.
- If `conversations.journey_id` exists, treat the current table as the migration-359 schema and continue idempotently.
- If `conversations` exists without `journey_id`, first verify that `conversations_legacy_pre_359` does not exist. If it does, raise a deterministic exception and leave both tables untouched because the migration runner wraps the file in a transaction.
- Otherwise rename the legacy table to `conversations_legacy_pre_359`. If its primary-key constraint is named `conversations_pkey`, rename that constraint to `conversations_legacy_pre_359_pkey`; PostgreSQL renames the backing index with it. This frees `conversations_pkey` for the new table.

The existing table definitions then run unchanged. Foreign keys that pointed at the legacy table continue to point at the renamed table because PostgreSQL tracks relation identity rather than textual names.

## Verification

A Vitest integration test connects to the configured test PostgreSQL database, creates a uniquely named schema, and sets that schema first in `search_path`. It creates minimal `journeys` and `golden_path` parents plus the production-shaped legacy `conversations` table and a row. It executes the exact migration file and asserts:

- execution succeeds;
- the new `conversations` table contains `journey_id`;
- the legacy row remains in `conversations_legacy_pre_359`;
- both primary-key constraints exist under distinct names;
- executing the migration a second time succeeds without renaming the new table;
- if an incompatible current table and the backup both exist, migration execution fails with the explicit ambiguity error and preserves both tables.

Every test schema is dropped in cleanup. The test refuses to run against a non-test database.

## Delivery

The hotfix branch targets `main`, runs the migration-specific real-PG test plus the normal Brain gates, and is merged only after GitHub checks pass. After merge, PR #4226 updates from `main`, bumps its Brain version if required, and reruns its unchanged kernel verification and GitHub check rollup.
