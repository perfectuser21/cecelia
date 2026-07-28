# Fleet GitHub Mutation Broker Design

## Goal

Remove GitHub credentials and mutation authority from provider containers while
preserving Kernel Generator's ability to publish one reviewed commit as a
draft pull request.

## Trust boundary

Brain freezes `github-mutation/v1` into the TaskBundle after resolving the
Fleet workspace. The policy binds repository, branch, base SHA, expected
remote SHA, operation, PR base/title/body and a server-owned allowed-path
allowlist. Remote transport copies only this exact policy. Worker validates it
against the launch request and persists the secret-free policy; the policy is
therefore included in the existing TaskBundle digest and cannot be selected by
provider output.

The provider container receives no GitHub token, `GH_TOKEN`, `.config/gh`,
Git credential file, Worker transport secret or mutation endpoint. A managed
Generator may commit locally and write only
`github-mutation-declaration/v1`: verdict, frozen branch and local HEAD SHA,
plus bounded fix notes for a fix Attempt. The Runner stages its normalized
provider result but does not perform Generator GitHub verification.

## Worker broker

After Docker reports terminal, Worker first durably enters
`mutation_pending`, removes the provider container while preserving Attempt
runtime/workspace, and then invokes the broker. The broker:

1. Validates exact policy/declaration bindings and rejects credential-bearing
   URLs.
2. Verifies clean worktree, exact current branch/HEAD, base ancestry and a
   non-empty committed diff.
3. Validates every changed path against the frozen allowlist and rejects path
   escapes, symlinks, submodules, binary diffs and added-line secret patterns.
4. Reads the remote branch. Before the first prepared audit record it must
   equal the frozen expected remote SHA (or be absent). After a prepared
   record it may equal either the expected SHA or the declared new HEAD.
5. Uses argv-only `git push --force-with-lease=refs/heads/<branch>:<expected>`
   and then reads the exact remote HEAD.
6. Reads an existing draft PR or creates exactly one with `gh pr create
   --draft`; it never marks ready or merges.
7. Uses the shared deterministic result finalizer to produce the canonical
   Generator HarnessResult, then resumes the existing callback receipt flow.

## Durable audit and recovery

One mode-0600, no-symlink JSONL journal exists per Attempt. Records are
append-only, fsynced and chained by SHA-256. Stages are `prepared`,
`push_confirmed`, and `draft_pr_confirmed`. Records contain only bindings,
digests and public PR metadata—never credentials, command output or provider
prompts.

Crash before push replays from `prepared` and performs the push. Crash after
push recognizes the declared HEAD remotely and does not push again. Crash
after PR creation finds the existing draft PR and records it. A completed
receipt is returned unchanged on retries. Any digest/binding/remote
disagreement fails closed and preserves evidence.

## Scope and limitations

This vertical slice supports the Cecelia repository's initial and fix
Generator Attempts. It creates or reuses draft PRs only. CI update, ready,
merge and promotion stay outside the broker. Fleet nodes must provide a
Worker-only authenticated `gh` environment; credential provisioning/rotation
is intentionally not implemented here. If the credential or policy is absent,
mutation fails closed.

## Test contract

Tests cover policy freezing and transport copying; absence of credentials from
Docker env/mount/state/audit; allowed and forbidden paths; path escape,
symlink, submodule, binary and secret rejection; remote lease conflict;
crash-before/after-push; crash-after-PR; exact retry; draft-only creation; and
Attempt restart from `mutation_pending`.
