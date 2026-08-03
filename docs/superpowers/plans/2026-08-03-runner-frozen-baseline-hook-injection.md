# Runner Frozen Baseline Hook Injection Implementation Plan

> Execute in the isolated `cp-0803-runner-frozen-hook-env` worktree with TDD.

**Goal:** Let writable frozen-baseline Fleet roles arm their pre-push guard when
the mounted Git admin config is not writable.

**Architecture:** Replace repository config mutation with an appended
process-scoped Git config entry. Preserve all lineage checks and fail closed when
the inherited Git process config is malformed or the effective hook path differs.

### Task 1: Reproduce the mounted-config failure

- Extend `docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh`
  with a linked-worktree fixture whose Git admin directory is not writable.
- Assert arming succeeds, persistent `core.hooksPath` stays unchanged, inherited
  process config is preserved, and the guard hook is effective.
- Run the test and retain the expected Red failure.

### Task 2: Implement process-scoped hook injection

- Update `docker/cecelia-runner/entrypoint.sh` to append and export one
  `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` entry.
- Validate `GIT_CONFIG_COUNT` and verify Git resolves the guard hook path.
- Run the focused Runner tests to Green.

### Task 3: Build and pin the immutable Runner

- Build the Runner image and obtain its content digest.
- Before Brain edits, run facts-check, version-sync, and DoD mapping DevGate.
- Update all canonical NodeProfile, rollout, reconcile, tests, Brain version, and
  `DEFINITION.md` references to the new digest.
- Run focused Fleet tests and full required verification.

### Task 4: Publish, merge, deploy, and validate

- Review the diff, commit, push the `cp-*` branch, open a PR, and wait for all CI.
- Fix any CI failure, squash merge without bypassing checks, then deploy exact SHA.
- Roll the pinned Runner to US M4, Xian M4, and Xian M1 and verify exact digests.
- Keep Brain tick disabled and run a fresh real Kernel Harness attempt against
  zenithjoy PR #1581; do not merge that business PR without fresh Evaluator and
  Judge attestations for its exact final SHA.
