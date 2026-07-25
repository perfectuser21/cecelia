# Runner Proposer Finalizer Design

## Problem

Kernel Proposer attempts receive `PROPOSE_BRANCH` and `SPRINT_DIR` from the server and the
Proposer skill explicitly requires a commit and remote push. In run
`466971c2-04e6-4f5e-9a83-30e575ca6a48`, three Codex attempts produced complete local
contract artifacts but stopped before that deterministic Step 4. The Kernel correctly
detected the missing remote branch and terminated with `gan_no_push_streak`, but repeating
the same LLM did not repair the missing effect.

The GitHub credential path is healthy: run `28f2fe30-1cc5-429a-93d5-50185133877f`
successfully pushed `cp-harness-propose-r17-f09c9e31-a7` with the same Runner image.
The failing boundary is therefore not authentication or server input. It is reliance on
probabilistic LLM compliance for a deterministic transport effect.

## Decision

Add a provider-neutral Proposer finalizer to the Runner. After a provider exits
successfully and before the callback is normalized, the finalizer enforces the existing
Proposer Step 4 using only server-injected environment values.

The finalizer:

1. Runs only for `HARNESS_NODE=proposer`.
2. Validates `PROPOSE_BRANCH` against
   `cp-harness-propose-rN-<task short id>-a<hop>`.
3. Accepts only a relative `SPRINT_DIR` below `sprints/` with no parent traversal.
4. Requires `contract-draft.md`, `contract-dod.md`, `task-plan.json`, and at least one
   test file.
5. Creates or resets the injected proposal branch at the current worktree head while
   preserving local changes.
6. Stages only the current sprint's required artifacts, commits them when needed, and
   pushes `HEAD` to the injected remote branch without force.
7. Rewrites only `.brain-result.json.propose_branch`,
   `.brain-result.json.workstream_count`, and `.brain-result.json.task_plan_path` to the
   authoritative injected values.
8. Verifies the remote ref after push.

If validation or Git fails, the finalizer returns non-zero and leaves the existing Kernel
no-push detector authoritative. It never pushes partial artifacts, arbitrary paths,
provider-reported branch names, read-only roles, or failed provider executions.

## Alternatives

- Brain host-side finalization was rejected because it crosses the container/callback
  boundary and duplicates Runner knowledge about the live worktree.
- More LLM retries were rejected because the production reproduction already exhausted
  the streak without convergence.
- Manual push was rejected as a durable solution because it would hide the protocol gap
  and fail again on the next task.

## Verification

The permanent Runner contract test uses a real temporary Git worktree and bare remote.
It proves successful commit/push and canonical result normalization, plus fail-closed
behavior for an invalid branch and incomplete artifacts. The existing provider-neutral,
Git credential, evaluator evidence, and Codex sandbox assertions remain unchanged.

