# Fleet Worker Workspace Phase 4B Implementation Plan

> **Execution rule:** Use `superpowers:executing-plans` and
> `superpowers:test-driven-development`. Every production behavior starts with a
> test that is observed failing for the intended reason.

**Goal:** Route every canonical Fleet node, including US M4, through one
authenticated Worker Attempt API and make the Worker own the per-Attempt Git
worktree/container lifecycle.

**Architecture:** This closes existing Commander/Fleet wiring; it does not add a
new scheduler. Brain continues to choose `ExecutionTarget`, account, model, and
role. Brain sends a path-free `WorkspaceSpec` to the selected node's Fleet
Worker. The Worker validates the immutable Git inputs, creates an Attempt-owned
worktree from its controlled mirror, starts the pinned OrbStack/Docker runner
with a read-only or read-write outer mount, and owns inspect, cancel, terminal
cleanup, restart reconciliation, and quarantine. Phase 4C remains solely
responsible for central credential envelopes and removing legacy credential
fallbacks.

**Base:** `origin/main` at Phase 4A merge
`1dc9d4107cc14f9bc509c1ef285845f1dfb13838`.

**Out of scope:** deployment, copying US M4 configuration to live nodes,
credential migration, Xian credential cleanup, SessionStore portability,
failure-set recovery, and real-task acceptance. A smoke test proves the local
contract only; it is not a synthetic substitute for Phase 5 real-task
acceptance.

## Dependency graph

```text
Phase 4A merged
  └─ WorkspaceSpec contract
       ├─ Worker-owned mirror/worktree lifecycle
       │    └─ Worker-owned container lifecycle + reconciliation
       └─ unified Fleet Worker HTTP client
            └─ US/Xian production transport wiring

Workspace lifecycle + HTTP wiring
  └─ Phase 4B contract smoke / RCI / version
       └─ Phase 4B PR, unmerged for independent review

Phase 4B merge
  └─ Phase 4C credential envelope
       └─ Phase 4D execution/recovery equivalence
```

## Frozen request and state contracts

`WorkspaceSpec` is the only cross-machine workspace input:

```json
{
  "repo": "perfectuser21/cecelia",
  "base_sha": "0123456789012345678901234567890123456789",
  "branch": "cp-07272050-fleet-worker-workspace-4b",
  "expected_head_sha": null,
  "mode": "read-write",
  "run_id": "11111111-1111-4111-8111-111111111111",
  "attempt_id": "22222222-2222-4222-8222-222222222222"
}
```

The schema rejects unknown fields, absolute or relative cwd/path fields,
non-canonical repository slugs, non-lowercase 40-character SHA values, unsafe
branch names, mismatched run/Attempt IDs, and mode values outside
`read-only|read-write`.

Worker Attempt routes are:

```text
POST   /harness/attempts
GET    /harness/attempts/:attempt_id
POST   /harness/attempts/:attempt_id/cancel
POST   /harness/attempts/:attempt_id/terminal
```

All routes except `/health` require the existing bearer secret. The launch body
contains Attempt lease identity, `ExecutionTarget`, provider command data,
callback coordinates, and `workspace_spec`; it never contains caller cwd or a
host worktree path. Receipts retain the existing required
requested/actual-machine attestation fields while naming the execution
transport `fleet-worker`.

Worker state is a bounded JSON record below the Worker-owned state root. Its
ownership labels are:

```text
cecelia.fleet.attempt_id=<uuid>
cecelia.fleet.run_id=<uuid>
cecelia.fleet.worker_id=<canonical-machine-id>
```

Reconciliation may remove only containers/worktrees carrying all three matching
ownership values. A cleanup error atomically moves the state/worktree reference
under the Worker quarantine root and prevents reuse.

The controlled mirror is staging-only. Each Attempt clones an independent bare
Git common-dir with `--no-hardlinks`; only that private admin directory is
mounted at its identical absolute path in the container. A writer therefore
cannot mutate shared refs, objects, or another Attempt's worktree metadata.

## Phase 4B file boundary

Create:

- `packages/brain/src/orchestrator/workspace-spec.js`
- `packages/brain/src/orchestrator/workspace-spec.test.js`
- `packages/brain/scripts/fleet-worker/workspace-manager.cjs`
- `packages/brain/scripts/fleet-worker/workspace-manager.test.cjs`
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- `packages/brain/scripts/smoke/fleet-worker-workspace-smoke.sh`

Modify:

- `packages/brain/src/orchestrator/execution-contract.js`
- `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- `packages/brain/src/orchestrator/dispatcher.js`
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- `packages/brain/src/orchestrator/production-transport.js`
- `packages/brain/src/orchestrator/production-transport.test.js`
- `packages/brain/src/orchestrator/execution-transport.js`
- `packages/brain/src/orchestrator/execution-transport.test.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- `packages/brain/src/orchestrator/providers/grok.js`
- `packages/brain/src/orchestrator/providers/grok.test.js`
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- `packages/brain/src/docker-executor.js`
- `packages/brain/src/__tests__/docker-executor.test.js`
- `packages/brain/scripts/codex-bridge/codex-bridge.cjs`
- `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`
- `docker-compose.yml`
- `regression-contract.yaml`
- `docs/registry/features/orchestration.yml`
- `packages/quality/smoke-allowlist.txt`
- `DoD.md`
- `.brain-versions`
- `DEFINITION.md`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- `package-lock.json`

Any additional file is a scope exception and must be justified in the PR body.
The Grok adapter pair is a review-closure exception: removing the caller
worktree path otherwise serialized `null` into Grok's `--cwd` argument.

## Red oracle

The implementation must first record failures for these behaviors:

1. `WorkspaceSpec rejects absolute cwd and non-canonical SHA`.
2. `Worker creates two concurrent writer Attempts in different worktrees`.
3. `read-only role cannot write through its outer mount`.
4. `terminal callback removes container and worktree`.
5. `failed cleanup quarantines the workspace`.
6. `US Attempt contacts Worker API instead of local Docker directly`.
7. `restart reconciles an owned orphan container/worktree without deleting
   another Attempt`.
8. `Worker rejects caller-supplied cwd/worktree_path before any Git or Docker
   side effect`.
9. `Workspace expected_head_sha mismatch prevents runner start`.
10. `unknown or unauthenticated Worker Attempt requests fail closed`.

## Task 1: Freeze WorkspaceSpec and TaskBundle contracts

**Files:** create `workspace-spec.js`, `workspace-spec.test.js`; modify
`execution-contract.js` and its test.

1. Add tests for the exact valid shape, strict unknown-field rejection,
   absolute `cwd`/`worktree_path` rejection, canonical lowercase SHA values,
   UUID equality, repository allowlist, branch safety, and read-only mode
   agreement with `TaskBundle.constraints.read_only`.
2. Run:

   ```bash
   cd packages/brain
   npx vitest run src/orchestrator/workspace-spec.test.js \
     src/orchestrator/__tests__/execution-contract.test.js
   ```

   Expected Red: missing module/schema and acceptance of legacy path-only
   bundles.
3. Implement `parseWorkspaceSpec(value, expected)` and
   `buildWorkspaceSpec(value)` as strict, immutable contract helpers. Update the
   TaskBundle schema to require `workspace_spec` for Fleet execution while
   retaining `worktree_path` only as an optional legacy provider hint that is
   never serialized to the Worker.
4. Re-run the two files; expected Green. Commit:

   ```text
   feat(fleet): freeze worker workspace contract (Red)
   feat(fleet): enforce worker workspace contract (Green)
   ```

## Task 2: Implement Worker-owned Git workspace lifecycle

**Files:** create `workspace-manager.cjs` and its test.

1. Use real temporary Git repositories in tests. Cover controlled mirror
   initialization/fetch, SHA verification, unique concurrent worktree paths,
   read-only metadata, expected-head mismatch before execution, idempotent
   cleanup, and quarantine on cleanup failure. Inject only command execution and
   filesystem roots; never accept a caller path.
   Each Attempt must receive a private, no-hardlink Git common-dir derived from
   its validated `attempt_id`; the shared mirror must never be mounted RW into
   a runner.
2. Observe Red with:

   ```bash
   cd packages/brain
   npx vitest run scripts/fleet-worker/workspace-manager.test.cjs
   ```

3. Implement `createWorkspaceManager({mirrorRoot, worktreeRoot,
   quarantineRoot, repoAllowlist, runCommand, fs})` with `prepare`,
   `verify`, `cleanup`, `quarantine`, and `reconcile` methods. Use argument
   arrays for all Git calls. Worktree paths derive only from validated
   `attempt_id`; mirror paths derive only from the repository allowlist.
4. Re-run Green and commit the Red and Green states separately.

## Task 3: Implement Worker-owned container lifecycle

**Files:** create `attempt-runner.cjs` and its test; modify
`docker-executor.js` and its test.

1. Add tests proving the runner:
   - prepares the workspace before Docker;
   - uses the NodeProfile-pinned image digest;
   - emits an outer `:ro` mount for `read-only` and `:rw` for `read-write`;
   - adds exact Attempt/run/worker labels;
   - rejects any unowned host mount;
   - terminal/cancel removes container then worktree;
   - quarantine follows either removal failure;
   - restart reconciliation touches only resources whose ownership tuple
     matches this Worker and state record.
2. Add a `docker-executor` regression that a Fleet call cannot fall back to its
   default host checkout and that the read-only flag produces an explicit
   `:ro`, not an omitted suffix.
3. Observe Red, then implement
   `createAttemptRunner({workspaceManager, docker, stateStore, workerId,
   runnerImageDigest})` with `launch`, `inspect`, `cancel`, `terminal`, and
   `reconcile`.
4. The provider command remains an argument array. Do not load, copy, log, or
   persist credentials in this task. Existing credential behavior is untouched
   until Phase 4C.
5. Run the focused tests Green and commit Red/Green separately.

## Task 4: Expose the authenticated Fleet Worker Attempt API

**Files:** modify `fleet-worker.cjs`, `fleet-worker.test.js`, Fleet Worker plist,
installer, and installer test.

1. Test bearer authentication, request-size and JSON bounds, strict launch
   schema, path-field rejection before runner invocation, conflict idempotency,
   inspect/cancel/terminal status codes, response redaction, and startup
   reconciliation.
2. Observe Red with:

   ```bash
   cd packages/brain
   npx vitest run scripts/fleet-worker/fleet-worker.test.js
   cd ../..
   bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
   ```

3. Extend `createFleetWorkerServer` by dependency-injecting `attemptRunner`.
   Keep `/health` unauthenticated and bounded. Wire the production main process
   to the Worker-owned roots, canonical machine ID, pinned digest, and secret
   file/env installed by the existing transactional installer. Do not put a
   secret literal in a plist.
4. Start reconciliation before accepting Attempt traffic; health may continue
   to report while Attempt routes return `503 worker_reconciling`.
5. Re-run Green and commit Red/Green separately.

## Task 5: Route US and Xian through the same Worker API

**Files:** modify `dispatcher`, execution/production/remote transport modules
and their tests, plus `docker-compose.yml`.

1. Add production tests showing all canonical machines map to server-owned
   `FLEET_WORKER_*_URL` values and use the same HTTP request contract. The US
   assertion must prove `spawnDetached` and direct Docker are never called.
2. Add transport tests showing the body contains `workspace_spec` and excludes
   `cwd`, `worktree_path`, local auth paths, and arbitrary extra mounts.
3. Add dispatcher tests showing a trusted immutable SHA and branch become the
   WorkspaceSpec and that missing/invalid SHA fails before reservation/launch.
   Preserve provider/account/model/machine routing as independent axes.
4. Observe Red with:

   ```bash
   cd packages/brain
   npx vitest run \
     src/orchestrator/production-transport.test.js \
     src/orchestrator/execution-transport.test.js \
     src/orchestrator/remote-bridge-transport.test.js \
     src/orchestrator/__tests__/dispatcher.test.js \
     src/orchestrator/preflight/production-wiring.test.js
   ```

5. Generalize the existing bridge HTTP client into the Fleet Worker client
   without creating a second protocol. `createProductionExecutionTransport`
   constructs one client over all three canonical Worker URLs. Remove the US
   direct-Docker launcher from the production path. Keep receipt and
   attestation validation, but identify every successful launch as
   `fleet-worker`.
6. Brain derives repository identity only from its server-owned repository map.
   SHA priority is immutable PR head/approved contract SHA, then an explicitly
   trusted task `base_sha`; mutable branch names are not accepted as SHA proof.
7. Re-run Green and commit Red/Green separately.

## Task 6: Close the legacy Bridge execution entrypoint

**Files:** modify `codex-bridge.cjs` and
`codex-bridge-kernel-attempt.test.js`.

1. Add a Red test proving the old Bridge `/harness/attempts` endpoint cannot
   start a host Codex process or use a fixed checkout after unified Worker
   routing is enabled.
2. Make the old endpoint return a bounded migration response or delegate to the
   loopback Fleet Worker client using the same authenticated request. It must
   not call `kernel-attempt-handler.cjs` for a new Kernel Attempt.
3. Preserve unrelated legacy Bridge routes. Do not delete credential files or
   alter credential selection; Phase 4C owns that migration.
4. Run the focused Bridge test Green and commit Red/Green separately.

## Task 7: Register the contract smoke, RCI, and Brain version

**Files:** create the smoke and modify the registration/version files listed in
the boundary.

1. The smoke uses a temporary real Git repository and a fake Docker command
   recorder. It proves unique writer paths, an explicit read-only mount,
   expected-SHA rejection before Docker, terminal cleanup, and quarantine.
2. Register the smoke as a P0 `must_never_break` provider-neutral Harness
   contract, add it to the allowlist and orchestration feature registry, and
   update DoD/Definition text.
3. Bump Brain `1.267.94` to `1.267.95` in all version sources and lockfiles.
4. Run:

   ```bash
   bash packages/brain/scripts/smoke/fleet-worker-workspace-smoke.sh
   bash scripts/check-version-sync.sh
   BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
   ```

5. Commit the registration/version update.

## Task 8: Verify and open an unmerged Phase 4B PR

1. Run focused tests:

   ```bash
   cd packages/brain
   npx vitest run \
     src/orchestrator/workspace-spec.test.js \
     src/orchestrator/__tests__/execution-contract.test.js \
     scripts/fleet-worker/workspace-manager.test.cjs \
     scripts/fleet-worker/attempt-runner.test.cjs \
     scripts/fleet-worker/fleet-worker.test.js \
     src/orchestrator/production-transport.test.js \
     src/orchestrator/execution-transport.test.js \
     src/orchestrator/remote-bridge-transport.test.js \
     src/orchestrator/__tests__/dispatcher.test.js \
     src/orchestrator/preflight/production-wiring.test.js \
     src/__tests__/docker-executor.test.js \
     src/__tests__/codex-bridge-kernel-attempt.test.js
   cd ../..
   bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
   bash packages/brain/scripts/smoke/fleet-worker-workspace-smoke.sh
   ```

2. Run repository gates:

   ```bash
   node scripts/devgate/check-new-api-endpoints.mjs
   node packages/engine/scripts/devgate/check-dod-purity.cjs
   bash scripts/check-version-sync.sh
   BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
   bash .github/workflows/scripts/lint-tdd-commit-order.sh origin/main
   bash .github/workflows/scripts/lint-test-quality.sh origin/main
   bash .github/workflows/scripts/lint-no-mock-only-test.sh origin/main
   bash .github/workflows/scripts/lint-no-fake-test.sh origin/main
   bash scripts/ci/run-core-regression.sh --tier pr
   git diff --check origin/main...HEAD
   ```

3. Review exact scope:

   ```bash
   git diff --name-only origin/main...HEAD
   git log --oneline --decorate origin/main..HEAD
   ```

4. Use `superpowers:verification-before-completion`, then
   `superpowers:requesting-code-review`. Resolve Critical/Important findings,
   re-run affected tests, push, and open a Phase 4B PR against `main`.
5. Keep the PR unmerged and stop for independent review. The PR body must state:
   - no deployment occurred;
   - OrbStack/Docker remains the only runtime;
   - US M4 remains the golden baseline;
   - no long-lived Xian Codex credential was added or copied;
   - the smoke is contract evidence, not real-task acceptance;
   - Phase 4C/4D remain incomplete.
