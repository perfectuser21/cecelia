# Kernel Judge Bundle Evidence Design

**Status:** approved for implementation under the Owner's standing instruction to finish the real-business Kernel Harness without bypassing Judge or human contract gates.

## Problem

Provider-neutral Fleet dispatch intentionally removes host-only `worktree_path` from persisted attempt bundles. The Kernel Judge still assumes that path is present and reads `contract-draft.md` and `sprint-prd.md` only from the host filesystem. In recovery run `2f3e1837-b52e-444b-b351-b60a067b301c`, the bundle carried the approved v15 `contract_content` and `prd_content`, but Judge ignored them, reported that no contract or Golden Path evidence existed, and terminated safely with `NEEDS_CONTEXT`.

## Decision

Judge evidence collection will accept immutable contract and PRD text already embedded in the attempt bundle. `spawn:judge` passes `bundle.inputs.contract.contract_content` and `bundle.inputs.contract.prd_content` into `runJudgeGate`. `collectEvidence` uses those strings as the primary evidence source and retains filesystem reads as a compatibility fallback for older local bundles.

The evidence gate will test whether contract E2E or Golden Path steps were actually parsed. It will not require a host worktree path when embedded evidence is available. Artifact persistence may remain best-effort when no local path exists.

## Rejected alternatives

- Re-add `worktree_path` to Fleet bundles: rejected because it leaks host topology and reverses the provider-neutral transport contract.
- Skip independent Judge for this run: rejected because contract v15 requires Judge and human review before merge.
- Copy contract files into an ad hoc temporary workspace: rejected because the approved bundle already contains the version-locked source of truth and extra copying creates drift.

## Scope

Modify only Judge evidence assembly and its tests, plus the required Brain version and both `DEFINITION.md` files. Do not change dispatcher transport, Fleet admission, Evaluator semantics, human review policy, or Zenithjoy product code.

## Data flow

1. Dispatcher stores approved contract metadata and contents in `task_bundle.inputs.contract`.
2. Kernel handler supplies embedded `contract_content` and `prd_content` to Judge.
3. Evidence collector parses embedded text; old local runs may fall back to `<worktree>/<sprint>/contract-draft.md` and `sprint-prd.md`.
4. Judge runs only when parsed contract E2E or Golden Path evidence exists; otherwise it continues to return `judged=false`, causing `NEEDS_CONTEXT` in strict Kernel mode.

## Testing

- Red integration regression: a Fleet-style bundle with no `worktree_path`, but with embedded contract/PRD, must invoke the default Judge and produce a grounded verdict.
- Compatibility: existing filesystem-backed Judge assembly remains green.
- Safety: no path and no embedded evidence still skips Judge.
- Run the focused Judge/Kernel suites, Brain facts/version checks, and the broader affected suite before PR creation.

