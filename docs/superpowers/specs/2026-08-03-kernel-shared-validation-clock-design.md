# Kernel Shared Validation Clock Design

## Problem

The production Kernel run reached Generator, but the Runner injected no
`HARNESS_PIPELINE_STARTED_AT` or `HARNESS_DEADLINE_AT`. The approved contract
requires Generator, Evaluator, Judge, and the final merge gate to share one
7200-second validation window. Letting a role create its own clock would make
the limit reset at every stage and would allow fabricated evidence.

## Decision

The Controller owns one validation clock per Kernel run. The clock starts at
the first allowed `spawn:generator` intent, not at Planner/GAN startup. The
Controller records both timestamps in that append-only decision-log intent and
copies them into every Generator, Evaluator, and Judge TaskBundle.

The first timestamp is the Controller's intent time. The deadline is exactly
`tasks.payload.timeout_seconds` later (7200 seconds for the production canary).
Retries and resumed attempts reuse the earliest recorded Generator clock. For
pre-fix runs whose first Generator intent lacks explicit clock fields, the
Controller derives the same immutable clock from that intent's persisted
`created_at` and records it on the next dispatch.

The Fleet Worker validates the two TaskBundle values and exposes them as
`HARNESS_PIPELINE_STARTED_AT` and `HARNESS_DEADLINE_AT`. It never generates or
rewrites them. Missing, malformed, or non-positive windows fail closed before
the Provider starts.

## Boundaries

- No product changes to PR #1581.
- No new database columns or mutable run state.
- No per-role deadline reset.
- No synthetic Evaluator or Judge evidence.
- Existing overall `initiative_runs.deadline_at` remains the automation-run
  watchdog; the validation clock is a separate, shorter evidence window.

## Verification

Tests prove that the first Generator gets a Controller-owned clock, retries and
Evaluator/Judge reuse it, legacy in-flight Generator intents recover from
persisted `created_at`, and the Fleet Worker injects the exact TaskBundle values
without mutation. Production verification inspects the resumed Runner env and
requires fresh real-business Evaluator and Judge evidence before merge.

