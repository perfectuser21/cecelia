# Golden Path §③ Ledger Data Knife Implementation Plan

> Execute with `superpowers:executing-plans`; implementation uses strict
> Red → Green and stops before §④.

**Goal:** Make the existing product Golden Path cell ledger truthful and
queryable, place NFR decisions on product journey steps, and enforce the §③
readiness prerequisite.

**Architecture:** Keep `journey_step_links` as the sole product GP cell SSOT.
Add a pure assertion-reference classifier, migration 373 for deterministic
backfill and `journey_step` NFR targets, and replace the broken product ledger
read model. Brain's internal module-health ledger remains separate.

**Tech:** Node.js ESM, Express, PostgreSQL migrations, Vitest, Bash smoke.

---

## Task 1: Capture the current failures as Red tests

**Files:**

- Add: `packages/brain/src/lib/__tests__/journey-cell-assertion.test.js`
- Modify: `packages/brain/src/routes/__tests__/journey-steps-ledger.test.js`
- Modify: `packages/brain/src/routes/__tests__/journeys-step-impact.test.js`
- Add: `packages/brain/src/__tests__/migration-373-gp-ledger-data-knife.test.js`

**Steps:**

1. Add classifier tests for test/manual/eval/decision/N/A/missing.
2. Replace the old mocked `journey_features` ledger expectation with direct cell
   rows, NFR decisions, four zones, readiness counts, and an explicit assertion
   that the source does not import `eleven-elements-ledger`.
3. Add impact-route tests proving semantic anchors are not runnable and missing
   anchors remain `needs_assertion=true`.
4. Add static migration contract tests for `journey_step`, deterministic NFR
   source refs, anchor backfill, and evidence-less positive-state downgrade.
5. Run only these tests and record their expected failure before implementation.

## Task 2: Implement assertion classification

**Files:**

- Add: `packages/brain/src/lib/journey-cell-assertion.js`
- Modify: `packages/brain/src/routes/journeys.js`

**Steps:**

1. Implement a pure `classifyJourneyCellAssertion` function.
2. Use it in the impact endpoint.
3. Return `assertion_state`, `runnable`, `needs_assertion`, and accurate summary
   counts without changing database state.
4. Run classifier and impact tests to Green.

## Task 3: Add migration 373 and integration proof

**Files:**

- Add: `packages/brain/migrations/373_gp_ledger_data_knife.sql`
- Add:
  `packages/brain/src/__tests__/integration/migration-373-gp-ledger-data-knife.integration.test.js`
- Modify: `packages/brain/vitest.config.js`

**Steps:**

1. Extend `decisions_target_type_chk` with `journey_step`.
2. Seed the four GP-B step NFR decisions with stable source refs.
3. Backfill base-reference assertions from real feature anchors.
4. Normalize existing decision and mixed test references.
5. Add only defensible direct business-smoke references.
6. Downgrade remaining evidence-less green/pending rows to red.
7. Add integration assertions for idempotency, positive-state evidence, valid
   NFR homes, and recognized references.
8. Run migration tests to Green.

## Task 4: Converge the product ledger read model

**Files:**

- Modify: `packages/brain/src/routes/journeys.js`
- Modify: `packages/brain/src/routes/__tests__/journey-steps-ledger.test.js`
- Add:
  `packages/brain/src/__tests__/integration/journey-step-ledger.integration.test.js`

**Steps:**

1. Remove the product route's `computeLedgerStatus` import.
2. Query step + journey metadata, direct cell rows, base feature anchors, and
   active `journey_step` NFR decisions.
3. Group cells into capability/element/scenario/base_ref without changing the
   11-element structure.
4. Return readiness counts from the shared classifier.
5. Prove missing step is 404 and database failure is 500.
6. Run unit and integration tests to Green.

## Task 5: Enforce §③ readiness before §④

**Files:**

- Add: `packages/brain/src/gp-ledger-readiness.js`
- Add: `packages/brain/src/__tests__/gp-ledger-readiness.test.js`
- Add: `packages/brain/scripts/smoke/gp-ledger-phase3-readiness-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`

**Steps:**

1. Red-test the reusable readiness summary and fail-closed verdict.
2. Implement database checks for evidence-less positive cells, orphan NFR cells,
   invalid base references, and unknown assertion forms.
3. Add a real-environment smoke that applies the readiness check against the
   migrated database and probes a real journey-step ledger endpoint.
4. Register the smoke in the existing allowlist.
5. Run unit test and smoke locally.

## Task 6: Version, definition, and focused regression

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`
- Add a learning only if the repository learning gate requires one.

**Steps:**

1. Bump Brain from `1.267.133` to the next patch version.
2. Document the single-SSOT product ledger, NFR home, backfill honesty, readiness
   gate, and rollback.
3. Run focused unit tests, migration integration tests, new smoke, Brain version
   gate, facts check, migration unique-version lint, and relevant DevGates.
4. Run the full Brain unit/integration suites required by changed paths.

## Task 7: Review, CI, and integration

1. Inspect the full diff for accidental §④ behavior.
2. Verify no `last_verified`, stamping, conflict-ledger, retirement, incident
   library, return-rate, or Phase 5 changes exist.
3. Commit in TDD order where repository gates require it.
4. Push the feature branch, open a PR, and monitor every latest check.
5. Fix in-scope CI failures; document unrelated pre-existing main failures.
6. Squash merge only after all PR-required checks are green.
7. Verify production Brain exact SHA, health, migrated readiness smoke, NFR home,
   and product ledger HTTP 200.
8. Report updated overall completion and a §④ handoff, then stop at the §③
   boundary.
