# PR #4226 Second Independent Review Fix Plan

> Execute in `cp-07231527-ws-50170af2`. Keep the PR open and unmerged. Every behavior change starts with a regression test that demonstrably fails before its implementation.

## Scope and invariants

- Preserve all existing PR #4226 evidence and contract tests.
- A merged PR always converges to `done`; no convergence fence may overwrite it.
- Only server-verified GitHub state is trusted for SHA convergence.
- Human-review decisions are keyed to the exact review request hop and SHA.
- Human-review deadline suspension applies only while the current derived decision is `wait:human_review`.
- Legacy callback rows with `verification_status = null` remain compatible and count as verified.
- Missing callbacks receive one durable observation cycle, then terminate with their own reason.
- Do not merge or modify tests merely to make an incorrect implementation green.

## Red→Green groups

### Group 1: terminal precedence and judge classification

Files:

- `packages/brain/src/orchestrator/derive.js`
- `packages/brain/src/orchestrator/kernel-handlers.js`
- `packages/brain/src/orchestrator/__tests__/derive.test.js`
- `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`

Red:

- Add a merged-plus-no-progress regression proving the current ordering incorrectly fails.
- Add a judge regression proving an evaluator classification currently fills a missing judge classification.

Green:

- Move the merged short-circuit before convergence failure handling.
- Persist a missing judge `failure_class` as `null`, retaining evaluator classification only as audit detail.

### Group 2: callback verification and observation

Files:

- `packages/brain/src/routes/harness-callback.js`
- `packages/brain/src/orchestrator/constants.js`
- `packages/brain/src/orchestrator/counters.js`
- `packages/brain/src/orchestrator/derive.js`
- `packages/brain/src/orchestrator/loop.js`
- callback/convergence regression tests under `tests/regression/relay-50170af2/`

Red:

- Resolver transport failure must persist `verification_pending` and must not become no-progress.
- A legacy callback with no verification field must replay as verified.
- A missing callback must wait for one persisted observation before failing with `generator_fix_callback_missing_after_observation`.

Green:

- Split invalid/mismatched SHA from resolver-unavailable state.
- Reconcile pending callbacks against the next authoritative observed head.
- Treat `verification_status = null` consistently as legacy verified.
- Add a durable `wait:generator_fix_callback` action and consume it on the next replay.

### Group 3: evidence and human-review decisions

Files:

- `packages/brain/src/orchestrator/derive.js`
- `packages/brain/src/orchestrator/loop.js`
- `packages/brain/src/routes/harness-kernel-approvals.js`
- route, derive, signature, and approval-bridge regression tests

Red:

- A second unsigned `evidence_invalid` verdict must request human review instead of spawning another repair.
- Two review requests at different hops but the same SHA must each accept exactly one approval.
- A signed and authenticated rejection must be persisted once and derive to `FAILED`.

Green:

- Replay unsigned evidence verdicts and repairs using the same append-only log.
- Key decision deduplication by `(run_id, pr_head_sha, review_request_hop)`.
- Add `/reject` with the same resolver, authentication, transaction, deadline restoration, and idempotency guarantees as `/approve`.
- Consume the rejection only after the merged short-circuit.

### Group 4: deadline and watchdog binding

Files:

- `packages/brain/src/orchestrator/loop.js`
- `packages/brain/src/harness-relay-watchdog.js`
- deadline and watchdog tests

Red:

- An expired run with a stale open request but a non-review current decision must fail.
- Watchdog suspension must require the latest decision to be the matching human-review request with a non-null PR head SHA.

Green:

- Bind loop deadline suspension to `decision.action === wait:human_review`.
- Restrict watchdog exclusion to a current, SHA-bearing request with no later decision-log row.

## Verification and delivery

1. Run each targeted Red test before its implementation and record the failure.
2. Run each targeted Green test after implementation.
3. Run the complete relay regression pool.
4. Run orchestrator/route unit and integration suites.
5. Run the real PostgreSQL suite and DevGate required by the original PRD.
6. Bump and verify the Brain patch version and `DEFINITION.md`.
7. Commit and push only `cp-07231527-ws-50170af2`.
8. Wait for the GitHub check rollup to be fully green.
9. Post the PR handoff summary with Red→Green evidence and leave PR #4226 unmerged for independent review.
