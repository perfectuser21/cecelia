# Remote approved-SHA artifact design

## Problem

Kernel contract approval records the immutable proposer commit SHA discovered from
`git ls-remote`. In production the Brain image's local Git object database does
not necessarily contain that remote-only commit. `readGitArtifact()` currently
runs only `git show <sha>:<path>`, so a valid approved contract is reported as
`approved_but_contract_artifacts_missing`.

## Decision

Keep the approved SHA as the sole artifact authority. Attempt the local read
first. If and only if Git reports that the object is missing, fetch that exact
40-character SHA from `origin` without tags, then retry the same immutable read.
Do not fall back to a moving branch or working-tree file.

## Safety

- Existing full-SHA and repository-relative path validation remains mandatory.
- Fetch uses `execFileSync`, not a shell.
- A real missing remote SHA still fails closed.
- Locally present SHAs do not perform network I/O.
