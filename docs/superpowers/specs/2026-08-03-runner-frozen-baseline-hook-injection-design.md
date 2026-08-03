# Runner Frozen Baseline Hook Injection Design

## Problem

Fleet worktrees are readable and writable inside OrbStack, while their shared Git
admin directory is owned outside the container. The frozen-baseline guard writes
`core.hooksPath` into that admin config before a writable role starts. On Xian M4
that write fails with `config.lock: Permission denied`, so the role never reaches
its provider.

## Decision

Keep the generated `pre-push` hook and post-provider lineage assertion unchanged,
but expose the hook through Git's process-scoped `GIT_CONFIG_COUNT` environment.
Append one `core.hooksPath` entry after any inherited process entries and verify
that Git resolves the expected path. Never mutate repository, worktree, global,
or system Git config.

Read-only roles continue to use only the post-provider lineage assertion.
Ordinary non-frozen development remains unchanged.

## Boundary

This PR contains the Runner fix, a production-shaped regression test, the rebuilt
immutable Runner digest, the three NodeProfile pins, and the required Brain
version/definition synchronization. Health snapshotting, bounded mirror fetches,
and cross-node artifact relay remain separate follow-up PRs.

## Verification

The regression creates a linked worktree, makes its Git admin directory
non-writable, arms the frozen guard, proves repository config is unchanged, and
proves the inherited process-scoped config activates the pre-push hook. Existing
lineage, read-only, credential, profile, rollout, and reconciliation tests must
remain green before real three-node rollout.
