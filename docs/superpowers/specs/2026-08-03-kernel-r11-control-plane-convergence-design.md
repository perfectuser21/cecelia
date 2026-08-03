# Kernel r11 Control-plane Convergence Design

**Date:** 2026-08-03  
**Status:** Approved direction; implementation pending plan review  
**Scope:** Kernel Harness control plane and pinned Runner only

## Goal

Make a real Kernel Harness run reach Generator, Evaluator, and Judge without an
infrastructure-blocked dispatch being misclassified as product non-progress.
Preserve fail-closed Fleet admission, read-only reviewer/evaluator workspaces,
exact-SHA evidence, and the existing Commander/Fleet architecture.

## Production evidence

Run `b3c74dad-0e21-4758-8a71-499c61d0736e` failed with
`gan_no_push_streak` after two Proposer attempts had both completed and pushed:

- hop 6 pushed r1;
- hops 17 and 19 were admission-blocked intents and created no Attempt;
- hop 21 pushed r2 at `60f8c2d6df6a9f56f6572d2692bee25d14ec0e44`;
- the counter nevertheless consumed the two blocked intent snapshots as a
  two-run no-push streak and killed the run before Generator/Evaluator/Judge.

The repeated dispatch block was not a disk-floor failure. The Fleet NodeProfile
already uses 10 GiB free space plus the 85% utilization ceiling. The separate
38.5 GiB Preview budget belongs to PR preview capacity, not Fleet admission.
The Kernel mismatch is temporal: the admission client declares a 20-second
default, but production assembly passes the generic 5-second
`production-probes` HTTP timeout into it, overriding that default. The outer
capability gate then defaults to 6 seconds. A successful cold US M4 health probe
was observed at 7.37 seconds, so the production budgets cannot contain the real
operation.

The r1 Reviewer also proved a protocol mismatch: `/workspace` was correctly
read-only, but the role still defaulted `BRAIN_RESULT_FILE` to
`/workspace/.brain-result.json`. Structured provider output survived, while the
legacy/mechanical result-file channel failed with `RESULT_FILE_READ_ONLY`.

## Design

### 1. Count completed role executions, not intents

Keep intent-before-dispatch for crash-safe audit, but remove intent snapshots as
the authority for `noPushStreak`.

For each `spawn:proposer` intent:

1. require a matching `effect:attempt_launched` whose `detail.dispatch_hop`
   equals the intent hop;
2. require a terminal, identity-bound callback/effect for that Attempt;
3. compare the authoritative proposal branch round before and after that
   completed execution;
4. count `false` only for a completed execution with no branch advance;
5. admission-blocked, needs-context, deadline-fenced, crashed-before-launch, and
   still-running intents are neutral and break the streak conservatively.

Apply the same identity rule to `noVerdictStreak`: a Reviewer intent is eligible
only after a matching launch and terminal callback; the role verdict row for the
same Attempt determines success. Admission-blocked Reviewer intents are neutral.

Historical rows without launch/callback identity do not count. `MAX_HOPS` and
the budget/deadline caps remain the final safety bounds.

### 2. Make timeout budgets nested and observable

Separate the timeout domains instead of reusing one value:

- ordinary Brain snapshot/provider HTTP calls retain the 5-second default;
- Fleet Worker admission receives its own 20-second default;
- the production outer capability probe budget becomes 25 seconds.

Test overrides remain available for fast unit tests. This does not weaken
admission checks or bypass the Worker probe.

Preserve admission reason codes through `production-probes` and the capability
gate. A block must expose bounded, redacted reason evidence such as
`worker_timeout`, `worker_http_503`, `health_probe_busy`, or the evaluated field
failure instead of collapsing every case to `node_not_base_admitted`.

The first PR will not guess which individual 5-second Worker command should be
relaxed. Exact reason propagation lands first; a command-specific timeout change
requires a reproduced reason and a separate Red test.

### 3. Put structured result files on the runtime channel

For read-only roles, the Runner injects a per-Attempt path under its existing
read-write runtime mount, for example:

`BRAIN_RESULT_FILE=/tmp/cecelia-prompts/brain-result.json`

All Runner finalizers and the evaluator evidence bridge read that injected path.
The path is never mounted from another Attempt and is checked against current
`task_id` and `attempt_id`. `/workspace` remains read-only; no writable file or
subdirectory is punched through the repository mount.

Writable roles retain compatibility with the existing workspace result where
required, but the injected path is the protocol authority when present.

### 4. Preserve failure classes

Admission and transport failures remain `infrastructure_blocked`; they cannot
consume product GAN/fix convergence counters. Product failure counters advance
only from identity-bound completed Attempts and verified artifacts.

## Red tests

1. Two blocked Proposer intents plus two successful pushed Proposer Attempts
   derive `noPushStreak=0`.
2. Two launched, terminal Proposer Attempts with no branch advance derive
   `noPushStreak=2`.
3. An in-flight or callback-less Attempt is neutral.
4. Blocked Reviewer intents do not consume `noVerdictStreak`; two launched,
   terminal Reviewers without a role verdict do.
5. Production wiring gives the outer gate a budget greater than the admission
   client and accepts a simulated 7.4-second cold admission.
6. A generic 5-second HTTP timeout no longer overrides the Fleet admission
   client's 20-second default.
7. Worker/admission reason codes survive into blocked capability evidence and
   secrets remain redacted.
8. Reviewer and Evaluator can write the injected runtime result path while
   `/workspace` is read-only.
9. Evaluator evidence bridge accepts only the current task/Attempt result from
   the injected path and rejects stale/foreign evidence.

## Delivery and validation

1. Land Red tests, then the smallest Green implementation.
2. Bump Brain and Runner versions and update `packages/brain/DEFINITION.md`.
3. Run targeted unit/shell suites, Brain regression tests, DevGate, and CI.
4. Build one pinned Runner digest and deploy/admit US M4 first.
5. Keep tick off and launch a new real r12 from the exact business PR SHA.
6. Accept only a trace containing real Planner/Proposer/Reviewer/Generator,
   exact-SHA Evaluator, and independent Judge. No synthetic canary substitutes
   for that acceptance.
7. Merge the business PR only after current Evaluator and Judge both pass the
   same final SHA.

## Non-goals

- no Phase 4B/4C/4D or Phase 5 work;
- no replacement of OrbStack/Docker;
- no change to the 10 GiB Fleet disk floor in this fix;
- no broad change to the independent Preview capacity policy;
- no long-term Codex credential on Xian;
- no direct push to `main`;
- no claim that the whole Provider-neutral Harness PRD is complete.
