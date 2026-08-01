# Kernel Judge Embedded Contract Mechanical Gate Design

## Problem

Fleet TaskBundles intentionally omit host `worktree_path`. Brain 1.267.164 already
passes the approved, version-locked `contract_content` and `prd_content` directly
to Independent Judge, but `runMechanicalGate()` still counts contract tests only
by scanning a host Sprint directory or rereading contract files from that path.
Consequently a valid Fleet Judge run can report `contract_tests=0` even when its
embedded approved contract contains concrete `[BEHAVIOR]` entries.

## Decision

Keep the Fleet envelope path-free. Extend the mechanical gate's contract-test
count to include concrete `[BEHAVIOR]` entries in `ctx.contractText`, using the
same line grammar as the existing file fallback. Host Sprint test files and
`contract-dod.md`/`contract-draft.md` remain compatibility fallbacks for legacy
local runs.

The gate does not trust an Evaluator-provided count and does not relax the
required structured `behavior_tests` evidence. Empty headings and empty list
items remain zero tests.

## Data Flow

1. Dispatcher embeds the approved contract in the Judge TaskBundle.
2. Kernel handler passes it as `contractText` to `runJudgeGate()`.
3. Evidence collection parses the contract and forwards the same locked text.
4. Mechanical gate counts concrete embedded `[BEHAVIOR]` entries before using
   legacy filesystem fallbacks.
5. All other mechanical and semantic Judge checks remain unchanged.

## Tests

Add a regression test with no usable host Sprint path, a compliant structured
behavior-test result, and an embedded contract containing one concrete
`[BEHAVIOR]` item. It must fail before the implementation with
`contract_tests=0` and pass after the implementation. Existing tests retain
coverage for missing, heading-only, and empty-list contracts.

## Rollback

Reverting to Brain 1.267.164 restores the false `contract_tests=0` failure for
path-free Fleet Judge runs. No schema or data migration is involved.
