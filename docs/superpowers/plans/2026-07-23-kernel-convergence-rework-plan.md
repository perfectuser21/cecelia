# Kernel Convergence Rework Implementation Plan

> **For Codex:** Execute this plan in the current one-session harness with
> test-driven development. Every R item needs an observed Red failure before
> its Green implementation. Do not merge PR #4226.

**Goal:** Replace the kernel repair loop's fixed-round termination with a
server-verified, replayable convergence detector and close independent-review
findings R1–R7.

**Architecture:** Reuse `orchestrator_decision_log` as the append-only event
history. GitHub and callback routes normalize untrusted inputs at IO boundaries;
`counters.js` reconstructs convergence state; `derive.js` remains the pure
routing authority; `loop.js` enforces deadline and terminal writes.

**Tech Stack:** Node.js ESM, Express, PostgreSQL JSONB/transactions, Vitest,
Supertest, GitHub CLI resolver.

---

## Task 1: Update the executable contract

**Files:**

- Modify: `sprints/07231527-relay-50170af2/sprint-prd.md`
- Modify: `sprints/07231527-relay-50170af2/contract-draft.md`
- Modify: `sprints/07231527-relay-50170af2/contract-dod.md`

**Steps:**

1. Replace fixed `MAX_FIX_ROUNDS=3`, `MAX_HOPS=60`, and 120-minute statements.
2. Add decision `9aeae77e`, the approved convergence matrix, 8-hour active
   deadline, human-review pause, R1–R7 tests, and R7 override of old immutable
   test wording.
3. Run contract/static checks that can execute before implementation and record
   expected failures only where the old implementation is intentionally stale.
4. Commit the contract update separately.

## Task 2: R1 + R7 — real approval router and per-SHA idempotency

**Files:**

- Modify: `tests/regression/relay-50170af2/kernel-approval-bridge.test.js`
- Modify: `packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js`
- Modify: `tests/regression/relay-50170af2/kernel-wiring-approval-route.integration.test.js`
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`

**Red:**

1. Replace T-17-c/d/e inline SQL replicas with a mounted real Router.
2. Add one run, SHA-A review/approval, then SHA-B review/approval.
3. Assert both requests return 202, duplicate per SHA returns 409, and the log
   contains exactly one approval row per SHA.
4. Run the three focused files and confirm the second SHA fails on old code.
5. Commit Red.

**Green:**

1. Scope duplicate query to `detail->>'pr_head_sha' = currentSha`.
2. Keep advisory locking and existing #4223 authentication unchanged.
3. Run focused router tests.
4. Commit Green.

## Task 3: R4 — shared SHA resolver and callback verification

**Files:**

- Create: `packages/brain/src/orchestrator/pr-head-resolver.js`
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/routes/__tests__/harness-callback.test.js`
- Modify: `tests/regression/relay-50170af2/kernel-wiring-no-progress-callback.integration.test.js`

**Red:**

1. Add uppercase, short, and fake 40-hex callback cases through the real
   callback writer.
2. Assert uppercase is stored only as resolver-confirmed lowercase, short SHA
   is rejected/no-progress, and fake SHA mismatch is no-progress.
3. Assert callback cannot choose the authoritative head from artifacts,
   decision, or provider metadata.
4. Run focused tests and commit Red.

**Green:**

1. Extract `normalizeGitSha` and `resolvePrHeadSha`.
2. Reuse the resolver in approval and callback paths.
3. Query the callback attempt's run PR URL and compare claimed SHA with current
   GitHub head before append.
4. Append a deterministic invalid/unverified callback outcome so replay can
   terminate instead of silently waiting.
5. Run focused tests and commit Green.

## Task 4: R2 — remove fixed fix cap, re-budget hops, pause active deadline

**Files:**

- Modify: `packages/brain/src/orchestrator/constants.js`
- Modify: `packages/brain/src/orchestrator/gates.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/harness-skill-relay.js`
- Modify: `packages/brain/src/harness-relay-watchdog.js`
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`
- Modify: `packages/brain/src/orchestrator/__tests__/constants.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/gates.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Modify: `tests/regression/relay-50170af2/kernel-deadline.test.js`
- Modify: `tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js`
- Modify: `tests/regression/relay-50170af2/kernel-wiring-fix-round.integration.test.js`

**Red:**

1. Assert arbitrarily high `fixRound` does not stop a progressing product fix.
2. Pin `MAX_HOPS=4096` and removal of `MAX_FIX_ROUNDS` route APIs.
3. Assert new runs receive 8 hours.
4. Assert an open, current-SHA human review pauses every loop deadline fence
   and relay watchdog; approval adds the paused duration back.
5. Assert `markRunFailed` cannot overwrite `done` or an existing `failed`.
6. Run focused tests and commit Red.

**Green:**

1. Remove fixed fix-cap constants/gates/routing; retain `fixRound` in counters.
2. Set the hop cap to 4096 and place it after convergence routing.
3. Add open-review detection by request hop and current SHA.
4. Extend deadline in the approval transaction using request `created_at`.
5. Guard terminal updates with `phase NOT IN ('done','failed')`.
6. Update watchdog query to exclude open kernel human review.
7. Run focused tests and commit Green.

## Task 5: R3 — judge missing classification

**Files:**

- Modify: `tests/regression/relay-50170af2/kernel-failure-class-routing.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Modify: `packages/brain/src/orchestrator/derive.js`

**Red:**

1. Add judge FAIL with absent/null classification through real `derive`.
2. Assert `wait:human_review`, reason `unknown:awaiting_human_review`.
3. Run focused tests and commit Red.

**Green:**

1. Normalize missing judge class to `unknown`.
2. Route through the existing failure-class matrix.
3. Run focused tests and commit Green.

## Task 6: R5 + R6 — structured repeat signatures

**Files:**

- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/counters.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/__tests__/counters.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Create: `tests/regression/relay-50170af2/kernel-convergence-signatures.test.js`

**Red:**

1. Add no-PR generator crash signature twice and assert FAILED on the second.
2. Add repeated evidence-invalid structured signature and assert human review.
3. Add approval unlock plus one more unchanged structured round and assert
   immediate FAILED without a second human review.
4. Run focused tests and commit Red.

**Green:**

1. Normalize optional evaluator/judge `failure_signature` arrays.
2. Persist signatures in verdict details and intent snapshots.
3. Replay crash/evidence repeat state in `deriveCounters`.
4. Route repeat and post-unlock states according to the approved design.
5. Run focused tests and commit Green.

## Task 7: Product failure-set convergence detector

**Files:**

- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/counters.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/counters.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Modify: `tests/regression/relay-50170af2/d707-replay.test.js`
- Create: `tests/regression/relay-50170af2/kernel-convergence-history.test.js`

**Red:**

1. Cover historical low, novel set, exact set recurrence, three novel sets
   without a new low, unstructured new SHA, and same-SHA terminal.
2. Cover recurrence → human review, not immediate FAILED.
3. Cover human unlock resetting patience to 1 and the next non-low round
   immediately FAILED without re-review.
4. Update d707 replay to require convergence/no-progress outcomes, never
   `fix_cap`.
5. Run focused tests and commit Red.

**Green:**

1. Preserve failed check names from GitHub rollup.
2. Store sorted failure sets on fix intents.
3. Reconstruct minimum size, seen-set keys, patience, and unlock state in
   counters.
4. Evaluate convergence before the hop fallback.
5. Ensure human-review effects include reason/signature and are emitted once.
6. Run focused tests and commit Green.

## Task 8: Version, regression, real PostgreSQL, and DevGate

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `DEFINITION.md`
- Modify only if required by test registration:
  `scripts/ratchet-registry.json`

**Steps:**

1. Bump Brain patch version in all four synchronized locations.
2. Run `git diff --check`.
3. Run all orchestrator unit tests and relay-50170af2 regression tests.
4. Run the real PostgreSQL kernel suite and require 8/8.
5. Run `node scripts/facts-check.mjs`.
6. Run `bash scripts/check-version-sync.sh`.
7. Run `node --check packages/brain/server.js`.
8. Run the repository DevGate required by the branch contract.
9. Commit version/verification metadata only after fresh Green evidence.

## Task 9: Independent review and PR handoff

**Steps:**

1. Push the existing branch; do not merge.
2. Run an independent evaluator against the PRD/design, diff, Red→Green
   evidence, and full verification output.
3. Run an independent different-vendor judge.
4. Address any FAIL through a new Red→Green cycle.
5. Wait for GitHub check rollup to report no non-green checks.
6. Post the required handoff comment to PR #4226 with commits, tests, CI
   evidence, and remaining issues.
7. Stop without approval token or merge.
