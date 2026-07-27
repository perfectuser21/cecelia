# Fleet Node Self-Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 4A bootstrap the US M4-derived, credential-free runtime baseline on all three macOS nodes through a fail-closed US M4 rollout command.

**Architecture:** A node-local reconciler installs pinned runtime artifacts and invokes the existing transactional Worker installer. A US M4-only rollout controller packages committed Git state plus the pinned Runner image, transfers them over SSH, runs reconciliation with `sudo -n`, and leaves every failed node drained.

**Tech Stack:** Bash, macOS Directory Services and launchd, OrbStack/Docker, Git bundles, SSH, Node.js, Vitest, shell behavioral tests.

---

## File map

- Create `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`:
  local idempotent runtime and service-identity reconciliation.
- Create `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`:
  executable behavioral contract with injected system commands.
- Create `packages/brain/scripts/fleet-worker/fleet-rollout.sh`:
  US M4 artifact builder, SSH transport, drain/admission controller.
- Create `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`:
  rollout mapping, ordering, isolation, and failure-closure contract.
- Modify `packages/brain/scripts/fleet-worker/fleet-nodectl.sh`:
  make bootstrap consume the baseline reconciler and make undrain safe when the
  LaunchDaemon is already loaded.
- Modify `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`:
  freeze bootstrap ordering and drain restoration.
- Modify `packages/brain/config/fleet-node-profiles.json` and
  `packages/brain/src/orchestrator/fleet-node/node-profile.js`:
  advance the shared OrbStack baseline to `2.2.1`.
- Modify `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`:
  prove exact shared baseline equality and permitted overlays.
- Modify `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template`:
  include the dedicated toolchain bin directory in Worker PATH.
- Modify `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`:
  freeze the dedicated PATH contract.
- Modify `packages/brain/DEFINITION.md`, `DEFINITION.md`, `.brain-versions`,
  `packages/brain/package.json`, `packages/brain/package-lock.json`,
  `package-lock.json`, `DoD.md`,
  `docs/registry/features/orchestration.yml`, and `regression-contract.yaml`:
  register the self-deploy behavior, tests, and Brain patch version.

## Task 1: Freeze the golden baseline

**Files:**

- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`

- [ ] **Step 1: Write the failing profile tests**

Add a test that extracts the shared fields from each profile:

```js
const overlays = new Set([
  'machine_id',
  'capacity',
  'worker_bind_host',
  'brain_health_url',
]);
const shared = (profile) => Object.fromEntries(
  Object.entries(profile).filter(([key]) => !overlays.has(key)),
);

expect(profiles.map(shared)).toEqual([
  shared(profiles[0]),
  shared(profiles[0]),
  shared(profiles[0]),
]);
expect(profiles.every(
  (profile) => profile.version_policy.orbstack === '2.2.1',
)).toBe(true);
```

- [ ] **Step 2: Run Red**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js
```

Expected: FAIL because the existing baseline is `2.1.1`.

- [ ] **Step 3: Implement the minimal baseline change**

Change the canonical JSON and JavaScript policy from:

```js
orbstack: '2.1.1'
```

to:

```js
orbstack: '2.2.1'
```

- [ ] **Step 4: Run Green**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js
```

Expected: all node-profile tests PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/src/orchestrator/fleet-node/node-profile.test.js
git commit -m "feat(fleet): advance shared OrbStack baseline"
```

## Task 2: Reconcile a node-local credential-free baseline

**Files:**

- Create: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- Create: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`
- Modify: `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`

- [ ] **Step 1: Write the failing shell contract**

The test must execute the real entrypoint with fake `id`, `dscl`, `curl`,
`shasum`, `hdiutil`, `ditto`, `orbctl`, `docker`, `git`, `npm`, and installer
commands. It must assert these independent behaviors:

```text
unknown machine                  -> exit 64, no mutation
default invocation               -> prints dry-run, no mutation
--apply as non-root              -> root_required
non-arm64                        -> unsupported_architecture
UID/GID 450 collision            -> service_identity_collision
missing _cecelia                 -> creates exact group and user records
missing Node                     -> verifies pinned SHA then installs v25.8.0
missing Codex                    -> installs @openai/codex@0.145.0 only
missing/older OrbStack           -> verifies pinned SHA then installs 2.2.1
newer OrbStack                   -> fails without downgrade
missing repository bundle       -> repository_bundle_required
missing Runner archive          -> runner_archive_required
valid bundle/archive            -> Git HEAD and Runner digest verified
successful apply                -> invokes install-fleet-worker.sh once
repeat successful apply         -> performs no duplicate installation
```

The test must also reject any output or command log containing:

```text
.codex
auth.json
credentials
CODEX_ACCOUNT
token
prompt
```

- [ ] **Step 2: Run Red**

Run:

```bash
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
```

Expected: FAIL because the reconciler does not exist.

- [ ] **Step 3: Implement canonical constants and parsing**

The script starts with:

```bash
#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION='25.8.0'
NODE_URL='https://nodejs.org/dist/v25.8.0/node-v25.8.0-darwin-arm64.tar.gz'
NODE_SHA256='75ff6fd07e0a85fb4d2529f6189c996014b1d3d83180c31e65feb2b3eaeec5d9'
CODEX_VERSION='0.145.0'
ORBSTACK_VERSION='2.2.1'
ORBSTACK_URL='https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.1_20628_arm64.dmg'
ORBSTACK_SHA256='5bc1719c3c987c4c60c65be9fdd65b4730990e1697ec1cb1c33e6bba31bf92b5'
RUNNER_DIGEST='sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36'
SERVICE_UID=450
SERVICE_GID=450
```

Accept only:

```text
reconcile-fleet-node-baseline.sh <machine> [--apply]
```

Default mode prints the exact planned component versions and exits without
creating a temporary directory.

- [ ] **Step 4: Implement service identity and toolchain reconciliation**

Use injectable command variables, with production defaults rooted at system
paths. Before creating records, search both UID and GID 450 and fail when they
belong to any record other than `_cecelia`.

Create the group attributes:

```text
PrimaryGroupID 450
Password *
RealName Cecelia Fleet Worker
```

Create the user attributes:

```text
UniqueID 450
PrimaryGroupID 450
NFSHomeDirectory /var/empty
UserShell /usr/bin/false
Password *
IsHidden 1
```

Install Node under:

```text
/usr/local/libexec/cecelia/toolchain/node-v25.8.0
```

Create stable commands under:

```text
/usr/local/libexec/cecelia/toolchain/bin
```

Install Codex with the pinned Node npm:

```bash
npm install --global --prefix "$TOOLCHAIN_PREFIX" "@openai/codex@$CODEX_VERSION"
```

- [ ] **Step 5: Implement OrbStack reconciliation**

Download to a fresh bounded temporary directory, compare the exact SHA-256,
mount read-only with `hdiutil`, and stage the signed app with `ditto`.

Behavior:

```text
absent or older -> install/upgrade to 2.2.1
exact           -> reuse
newer           -> fail closed; never downgrade
```

Start with the app's `orb` command and verify `orbctl version` plus
`docker info`. Always detach a mounted DMG through the cleanup trap.

- [ ] **Step 6: Implement Git and Runner import**

Require these regular, non-symlink inputs for `--apply`:

```text
FLEET_BASELINE_REPOSITORY_BUNDLE
FLEET_BASELINE_RUNNER_ARCHIVE
```

Initialize or reuse `/var/lib/cecelia/repository` as a bare repository, fetch
the bundle's `HEAD` into `refs/heads/fleet-baseline`, and point bare `HEAD` at
that ref. Set ownership to `_cecelia:_cecelia`.

Load the Docker archive and require:

```bash
docker image inspect \
  sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36
```

to succeed before invoking the Worker installer.

- [ ] **Step 7: Wire the dedicated Worker PATH**

Change the plist PATH to:

```text
/usr/local/libexec/cecelia/toolchain/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

Update the installer test to parse the rendered plist and require that exact
value.

- [ ] **Step 8: Run Green**

Run:

```bash
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
```

Expected: both contracts PASS.

- [ ] **Step 9: Commit**

```bash
git add \
  packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh \
  packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh \
  packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template \
  packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
git commit -m "feat(fleet): reconcile pinned node baseline"
```

## Task 3: Add the US M4 rollout controller

**Files:**

- Create: `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`
- Create: `packages/brain/scripts/fleet-worker/fleet-rollout.sh`

- [ ] **Step 1: Write the failing rollout contract**

Execute the real script with injected `git`, `docker`, `ssh`, `tar`, `sudo`,
and node-local command wrappers. Assert:

```text
default mode                    -> dry-run and no transport
unknown target                  -> exit 64
--apply off US M4               -> controller_machine_mismatch
xian-mac-m4 mapping             -> jinnuoshengyuan@100.86.57.69
xian-mac-m1 mapping             -> xx-macmini@100.88.166.55
all order                       -> xian-mac-m4, us-mac-m4, xian-mac-m1
source artifact                -> git archive of committed HEAD only
repository artifact            -> git bundle rooted at HEAD
runner artifact                -> docker save of pinned digest
remote apply                   -> BatchMode SSH and sudo -n
remote error                   -> node drain command is attempted
admission error                -> node drain command is attempted
success                        -> bootstrap, undrain, admit in order
```

Search the artifact manifest and transport log and fail if either contains a
home-directory account path, `.codex`, auth material, token, Prompt, or Bridge
`/run`.

- [ ] **Step 2: Run Red**

Run:

```bash
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
```

Expected: FAIL because `fleet-rollout.sh` does not exist.

- [ ] **Step 3: Implement parsing, mappings, and artifact construction**

Accept:

```text
fleet-rollout.sh <us-mac-m4|xian-mac-m4|xian-mac-m1|all> [--apply]
```

Require:

```bash
[[ "${CECELIA_MACHINE_ID:-}" == 'us-mac-m4' ]]
```

before apply. Construct artifacts from `HEAD`, never the working tree:

```bash
git archive --format=tar HEAD \
  packages/brain/package.json \
  packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/scripts/fleet-worker
git bundle create "$bundle" HEAD
docker save --output "$runner_archive" "$RUNNER_DIGEST"
```

Verify the source worktree is clean before building an apply artifact.

- [ ] **Step 4: Implement local and SSH transports**

For Xian targets use:

```text
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes
```

The remote shell creates a bounded `mktemp -d`, extracts the received tar, and
executes:

```bash
sudo -n env \
  FLEET_BASELINE_REPOSITORY_BUNDLE="$remote_root/repository.bundle" \
  FLEET_BASELINE_RUNNER_ARCHIVE="$remote_root/runner.tar" \
  CECELIA_MACHINE_ID="$machine_id" \
  "$remote_root/source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh" \
  bootstrap "$machine_id" --apply
```

Do not use Cecelia Bridge as a privileged transport.

- [ ] **Step 5: Implement drain and admission closure**

For each target:

```text
drain --apply
bootstrap --apply
undrain --apply
admit
```

If bootstrap, undrain, or admit fails, invoke `drain --apply` best-effort and
return non-zero. Stop `all` at the first failed machine. Do not report final
dispatch readiness; Phase 4A admission must still emit `dispatch_ready=false`.

- [ ] **Step 6: Run Green**

Run:

```bash
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/brain/scripts/fleet-worker/fleet-rollout.sh \
  packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
git commit -m "feat(fleet): add US M4 node rollout controller"
```

## Task 4: Integrate bootstrap and close the loaded-service edge case

**Files:**

- Modify: `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-nodectl.sh`

- [ ] **Step 1: Write the failing nodectl tests**

Add assertions that:

```text
bootstrap --apply invokes baseline reconciliation before Worker installation
baseline failure does not invoke Worker installation
undrain checks launchctl print before bootstrap
already-loaded service is kickstarted without a duplicate bootstrap
failed undrain restores the drain marker
```

- [ ] **Step 2: Run Red**

Run:

```bash
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
```

Expected: FAIL because bootstrap bypasses reconciliation and undrain always
bootstraps the plist.

- [ ] **Step 3: Implement the minimal integration**

Add:

```bash
BASELINE_RECONCILER="$SCRIPT_DIR/reconcile-fleet-node-baseline.sh"
```

and make apply bootstrap invoke only the reconciler; the reconciler owns the
final call to `install-fleet-worker.sh`.

For undrain:

```bash
if "$LAUNCHCTL" print "system/$LABEL" >/dev/null 2>&1; then
  "$LAUNCHCTL" kickstart -k "system/$LABEL"
else
  "$LAUNCHCTL" bootstrap system "$PLIST"
  "$LAUNCHCTL" kickstart -k "system/$LABEL"
fi
```

Restore the marker if either command fails.

- [ ] **Step 4: Run Green**

Run:

```bash
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
```

Expected: all contracts PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/brain/scripts/fleet-worker/fleet-nodectl.sh \
  packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
git commit -m "fix(fleet): close bootstrap rollout lifecycle"
```

## Task 5: Register behavior and verify Phase 4A

**Files:**

- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`
- Modify: `.brain-versions`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `DoD.md`
- Modify: `docs/registry/features/orchestration.yml`
- Modify: `regression-contract.yaml`

- [ ] **Step 1: Register tests before version metadata**

Add the three shell contracts to the Phase 4A regression and feature entries:

```text
reconcile-fleet-node-baseline.test.sh
fleet-rollout.test.sh
fleet-nodectl.test.sh
```

Update DoD to state that machine baseline rollout is automatic from US M4 but
production apply remains forbidden before PR merge.

- [ ] **Step 2: Run registry and contract Red/Green checks**

Run the registry and PR-tier regression commands declared by the repository:

```bash
node scripts/registry-lint.mjs
bash scripts/ci/run-core-regression.sh --tier pr
```

Expected: PASS after registration.

- [ ] **Step 3: Advance Brain patch metadata**

Advance the Brain patch version in the package and definition metadata. The
published Phase 4A branch uses `1.267.92` because `origin/main` advanced to
`1.267.91` before CI reconciliation.
Update lockfiles with:

```bash
npm install --package-lock-only --ignore-scripts
```

Review the lockfile diff and retain only the intended Brain version changes.

- [ ] **Step 4: Run the focused Phase 4A suite**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-profile.test.js \
  src/orchestrator/fleet-node/node-admission.test.js \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/preflight/production-wiring.test.js \
  scripts/fleet-worker/fleet-worker.test.js
cd ../..
bash packages/brain/scripts/fleet-worker/fleet-worker-docker-access.test.sh
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
```

Expected: all tests PASS; smoke may SKIP only for its documented non-Darwin or
missing-production-prerequisite cases.

- [ ] **Step 5: Run DevGate-equivalent verification**

Run:

```bash
git diff --check
npm test -w packages/brain
node scripts/devgate/check-contract-drift.mjs --base=origin/main
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: zero failures.

- [ ] **Step 6: Commit**

```bash
git add \
  .brain-versions \
  DEFINITION.md \
  DoD.md \
  package-lock.json \
  packages/brain/DEFINITION.md \
  packages/brain/package.json \
  packages/brain/package-lock.json \
  docs/registry/features/orchestration.yml \
  regression-contract.yaml
git commit -m "chore(fleet): register node self-deploy contract"
```

## Task 6: Review and update the existing Draft PR

**Files:**

- No new production files.

- [ ] **Step 1: Verify scope**

Run:

```bash
git diff --name-status origin/main...HEAD
git diff --check origin/main...HEAD
git status --short
```

Expected: only Phase 4A, documentation, version, registry, and test files; clean
worktree.

- [ ] **Step 2: Verify no credential material**

Run:

```bash
git diff origin/main...HEAD -- \
  packages/brain/scripts/fleet-worker \
  packages/brain/config/fleet-node-profiles.json |
  rg -n 'auth\\.json|credentials|CODEX_ACCOUNT|token|prompt|\\.codex'
```

Expected: no matches except explicit negative test assertions.

- [ ] **Step 3: Push to the existing PR branch**

Push fast-forward from the continuation branch to:

```bash
git push origin HEAD:cp-07270814-fleet-node-admission-4a
```

- [ ] **Step 4: Keep the PR unmerged**

Confirm PR #4367 remains Draft or otherwise explicitly unmerged. Report CI and
review status, then stop for independent review. Do not run production
`fleet-rollout.sh --apply` before merge.
