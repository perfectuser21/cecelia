# Golden Path §③ Ledger Data Knife Design

**Date:** 2026-07-30
**Status:** approved in session
**Scope:** finalized Harness Golden Path PRD §③ only
**Baseline:** `origin/main@264482fadd87dc8bf6e7d4534c156ee28e276ccf`

## 1. Outcome

Complete the data prerequisite that must precede §④:

1. backfill truthful assertion anchors around the existing Golden Path cells;
2. give step-level NFR decisions an unambiguous home;
3. converge the product Golden Path ledger on `journey_step_links`;
4. add a readiness gate that keeps §④ disabled until §③ is healthy.

This change does not implement assertion stamping, conflict accounting, retirement,
incident comparison, return-rate collection, or any Phase 5 canary.

## 2. Production as-built

The old planning statement “118 cells, 5 assertions” is stale. Production currently
contains:

- 122 `journey_step_links` cell rows;
- 8 non-null `assertion_ref` values;
- 44 green or pending rows, most without a cell-level evidence reference;
- 4 NFR element cells, all without a step-scoped NFR decision;
- 8 referenced foundation features, 6 with real test/workflow/guard anchors;
- a broken `GET /api/brain/journey_steps/:step_id/ledger` endpoint that returns 500
  because it selects `brain_modules` columns from `journey_features`.

There are two historically named “ledger” views:

- `/features/ledger` is Brain's internal module-health ledger over `brain_modules`;
- the product Golden Path ledger is the four-zone cell matrix in
  `journey_step_links`.

They are different domains. The internal endpoint remains; the product endpoint
must stop reusing its row calculator.

## 3. Invariants

1. `journey_step_links` remains the product GP cell SSOT. No parallel cell table.
2. The 11-element structure is unchanged.
3. Existing four-home enum remains `biz/pre/xcut/factory`.
4. A reference never means “verified”; verification stamping belongs to §④.
5. A green or pending cell must not remain evidence-less.
6. Red and gray cells may truthfully remain unanchored.
7. `na_reason` is allowed only as an explicit non-applicability explanation, not as
   a substitute for missing evidence.
8. Product NFR decisions target a product journey step, not a code feature and not
   the legacy Harness `golden_path` row.

## 4. Assertion reference contract

The existing `assertion_ref` column is retained. References are classified without
adding a schema column:

| Prefix / form | Class | Runnable |
|---|---|---|
| `tests/...`, repository test path | `test` | yes |
| `manual:<command>` | `manual` | yes |
| `eval:<evaluation contract>` | `evaluation` | no |
| `decision:<decision/source ref>` | `decision` | no |
| null + `na_reason` | `not_applicable` | no |
| null | `missing` | no |

The API reports `assertion_state`, `runnable`, and `needs_assertion`. A decision or
evaluation reference is a semantic anchor, not executable test coverage.

### Backfill policy

- A `base_ref` cell inherits a real `unit_test_path`, `workflow_ref`, or `guard_ref`
  from its referenced `journey_feature`, in that priority order.
- Existing free-text decision evidence is normalized to `decision:...`.
- Existing mixed prose-plus-test evidence is normalized to the real repository test
  path; prose remains available in migration comments/history.
- GP-B cell rows may use the existing ZenithJoy Path 4 business smoke only where the
  smoke directly covers the corresponding behavior.
- No `planned:` references are generated.
- If a legacy green/pending row has no defensible evidence after backfill, migration
  373 changes it to `red`. It does not manufacture coverage.

The result is not “122 green cells”. It is an honest ledger in which every positive
state has a named evidence source and incomplete work remains visibly incomplete.

## 5. NFR home

Migration 373 extends the constrained decision target vocabulary with
`journey_step`.

Each of the four current GP-B NFR cells receives an active decision:

| Step | NFR decision |
|---|---|
| message perceived | seconds-level perception; no loss and no duplication |
| decide responder | required human handoff must reach a responder |
| reply delivered | timely, appropriate reply with delivery confirmation |
| record and recover | conversation recording and actionable failure alerting |

The decision uses:

```text
category=nfr
level=step
target_type=journey_step
target_id=journey_steps.id
scope=v1
```

Its home is inherited through `journey_steps.journey_id -> journeys.home`. No NFR
is represented as a `journey_feature`, and no `feature_id` is added to an NFR cell.

## 6. Product ledger API

`GET /api/brain/journey_steps/:step_id/ledger` becomes a direct read model over:

- `journey_steps`;
- `journeys` for `home/domain`;
- `journey_step_links` for four-zone cells;
- `journey_features` only for base-reference metadata and anchor fallback;
- `decisions target_type='journey_step'` for NFR content.

It returns step metadata, cells grouped by `cell_kind`, assertion classification,
NFR decisions, and readiness counts. It does not import or call
`computeLedgerStatus`.

`GET /journeys/steps/:step_id/impact` uses the same assertion classifier so both
product views agree on runnable and missing counts.

`GET /features/ledger` remains unchanged because it is the internal Brain
module-health view, not a second product GP implementation.

## 7. §③ readiness gate

A reusable readiness query and smoke fail unless all conditions hold:

1. no green/pending cell has `assertion_state=missing`;
2. every NFR cell has an active `journey_step` NFR decision;
3. every `base_ref` has a valid `feature_id`;
4. all assertion references use a recognized form;
5. the product ledger route reads `journey_step_links` and does not import the
   internal module ledger calculator.

Migration 373 writes the data; unit/integration tests and a real-environment smoke
enforce it. The gate is included in the existing real-env smoke collection, making
§④ changes unable to obtain a green aggregate while §③ regresses.

## 8. Failure and rollback

- Migration 373 is idempotent.
- Existing decisions use deterministic source refs and upsert semantics.
- Rollback deploys Brain `1.267.133`; migration rows remain audit data.
- If the new route fails, it fails closed with HTTP 500 and does not mutate cells.
- No production row is stamped as verified by this change.

## 9. Acceptance

1. Migration integration test proves NFR target constraint and deterministic
   backfill.
2. Red tests reproduce the current 500-causing SQL shape and fail on the old route.
3. Product ledger returns all step cells directly from `journey_step_links`.
4. Green/pending rows without real evidence are zero after migration.
5. Four GP-B NFR cells each resolve one active step decision and `home='biz'`.
6. `/features/ledger` remains behaviorally unchanged.
7. §③ readiness smoke passes on a migrated database.
8. Brain version and both definitions are updated.
