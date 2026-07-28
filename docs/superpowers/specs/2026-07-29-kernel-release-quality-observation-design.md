# Kernel ReleaseRun Nightly Quality Observation Design

## Context and decision

PR #3717 introduced a production release gate: a production effect required at
least one successful `nightly-regression.yml` run on `main` completed within
the previous 48 hours. Commit `758708df24605b3acd5c9911f4ae356c4ac494f1`
removed the workflow job while closing legacy deployment bypasses.

There is no approved retirement record for the quality behavior. The durable
ReleaseRun design removed the workflow-owned `BYPASS_NIGHTLY_GATE` authority,
but did not replace the fresh-nightly requirement. As a result, the current
executor can advance directly from `staging_passed` to
`production_deploying`.

The quality behavior is therefore migrated, not retired. ReleaseRun becomes
its only production authority.

## Required behavior

Before the first `production_deploying` transition, the server must observe a
successful completed run of `.github/workflows/nightly-regression.yml` that:

- belongs to the ReleaseRun repository;
- ran on branch `main`;
- has conclusion `success`;
- has a valid GitHub Actions run id, exact 40-character head SHA, completion
  timestamp, and canonical repository run URL;
- completed no more than 48 hours before the server-owned observation time;
- is not timestamped in the future.

Missing, unavailable, malformed, failed, stale, or future-dated evidence must
return `BLOCKED`. No rollback intent, production intent, production command,
or production observation may occur.

There is no emergency environment variable, workflow input, caller assertion,
or risk classification that bypasses this gate.

## Architecture

### Pure quality contract

`release-run-quality.js` owns the constants and pure validation:

- workflow file: `nightly-regression.yml`;
- branch: `main`;
- freshness: 48 hours;
- GitHub repository/run URL validation;
- canonical receipt normalization.

The normalized receipt has exactly:

```json
{
  "status": "pass",
  "repository": "owner/repository",
  "workflow_file": "nightly-regression.yml",
  "branch": "main",
  "run_id": 123456,
  "head_sha": "0123456789012345678901234567890123456789",
  "conclusion": "success",
  "completed_at": "2026-07-29T00:00:00.000Z",
  "html_url": "https://github.com/owner/repository/actions/runs/123456"
}
```

The validator receives the expected repository and server observation time.
It does not accept caller-selected workflow, branch, freshness, or clock.

### Server-owned GitHub observation

`createReleaseRunAdapters()` exposes `observeReleaseQuality`. It invokes the
installed authenticated `gh` CLI against the repository bound to the
ReleaseRun:

```text
GET repos/{repository}/actions/workflows/nightly-regression.yml/runs
    ?branch=main&status=completed&per_page=5
```

The adapter parses the complete response, considers only successful runs, and
passes candidates through the pure validator. It returns the newest valid
canonical receipt. Transport errors, incomplete pagination, malformed
responses, or lack of a valid candidate become a fail-closed observation; raw
CLI error text and credentials are never persisted.

### ReleaseRun boundary and durability

`createReleaseRunExecutor()` requires the injected `observeReleaseQuality`
adapter. After staging is confirmed and the durable state is
`staging_passed`, it observes and validates quality before creating rollback
authority or transitioning to production.

The successful canonical receipt is persisted inside the append-only
`production_deploying` transition evidence as `release_quality`. That state
transition is the durable proof that the gate passed. A retry already in
`production_deploying` uses the persisted state and does not re-query or
weaken the gate.

No new table or migration is needed because transition rows are append-only,
unique per state, and already define the authorization boundary.

### Runtime wiring

`buildDefaultHandlers()` accepts an injectable `observeReleaseQuality` for
tests and otherwise wires the server-owned adapter implementation. The
production execution body receives repository and merge identity exclusively
from the immutable ReleaseRun row.

### Legacy surface retirement

The orphan `scripts/ci/check-nightly-green.sh` and its shell tests are removed.
Its `BYPASS_NIGHTLY_GATE=1` behavior is not retained.

`nightly-regression-config.test.js` continues to protect the scheduled nightly
workflows, but changes the release assertion from workflow text matching to
the durable ReleaseRun quality contract and executor/runtime wiring.
Production workflow surfaces remain thin ReleaseRun authorization consumers.

## Failure and recovery semantics

- Adapter unavailable: `release_quality_adapter_unavailable`.
- GitHub observation unavailable or malformed:
  `release_quality_observation_unavailable`.
- No successful fresh canonical run:
  `release_quality_not_passed`.
- Validator-specific malformed, stale, or future evidence is normalized to
  `release_quality_not_passed` at the executor boundary; no untrusted details
  are persisted.
- After `production_deploying`, existing ReleaseRun recovery semantics apply.
  The gate is not re-evaluated because its canonical receipt is already in the
  append-only transition.

## Verification

Permanent tests prove:

1. Pure validation accepts only exact canonical fresh evidence and rejects
   wrong repository/workflow/branch/conclusion, malformed ids/SHA/URL/time,
   future timestamps, and age greater than 48 hours.
2. The production adapter selects a valid fresh success and fails closed on
   stale, failed, malformed, incomplete, or unavailable GitHub observations.
3. The executor blocks at `staging_passed` before rollback or production
   authority/effects when quality evidence is absent or invalid.
4. A successful gate persists the exact canonical receipt in the
   `production_deploying` transition.
5. Runtime wiring supplies the server-owned adapter by default and preserves
   test injection.
6. No production workflow or retained script exposes a nightly bypass.
7. Existing ReleaseRun executor, adapter, surface, CI configuration, and
   DevGate suites remain green.

## Scope exclusions

- The nightly workflow itself is not redesigned.
- The 48-hour policy is not changed.
- The quality gate does not require the nightly head SHA to equal the merge
  SHA; that would be a stronger, different policy and has no approved
  retirement/migration decision.
- Production deployment, PR creation, merge, and live rollout are not part of
  this branch.
