# Provider-neutral Harness Phase 4A Production Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task in the current
> one-session Harness. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge `us-mac-m4`, `xian-mac-m4`, and `xian-mac-m1` on the
fail-closed Fleet Node Contract already merged in PR #4367, without importing
Phase 4B, 4C, 4D, or Phase 5 acceptance into this PR.

**Architecture:** Brain Control Plane and the Kernel Run Controller stay on
`us-mac-m4`. All three nodes use the same committed NodeProfile baseline,
OrbStack/Docker Runner archive, system LaunchDaemon, and health/admission
contract; only identity, listener/callback overlay, and reserved base capacity
differ. macOS `15.7.4` is the minimum Sequoia patch baseline so the US node can
remain online while Xian nodes install a newer `15.7.x` security patch.

**Tech Stack:** Node.js ESM/CommonJS, Vitest, Bash contract tests, macOS
launchd, OrbStack/Docker, SSH/Tailscale, Cecelia DevGate.

---

## Authority and dependency graph

```text
Phase 0B capability/fallback + Phase 0C telemetry + Phase 3 transport/receipt
                                │
                                ▼
Phase 4A Fleet Node Contract and admission             ← this PR/deployment
  NodeProfile + pinned Runner + LaunchDaemon + self-check + weighted capacity
                                │
                                ▼
Phase 4B unified Worker API and isolated WorkspaceSpec  ← out of scope
                                │
                                ▼
Phase 4C central CredentialEnvelope                     ← out of scope
                                │
                                ▼
Phase 4D execution equivalence/recovery closure         ← out of scope
                                │
                                ▼
Phase 5 real mixed-machine business canary              ← out of scope
```

Phase 4B consumes an admitted Worker API and owns workspace/container
lifecycle. Phase 4C depends on that lifecycle boundary and owns only ephemeral,
single-Attempt credentials. Phase 4D consumes 4A–4C to close failure/recovery
equivalence. Phase 5 is the first valid real-business acceptance gate;
synthetic probes remain infrastructure evidence only.

## Production as-built, 2026-07-28

| Surface | `us-mac-m4` | `xian-mac-m4` | `xian-mac-m1` |
|---|---|---|---|
| Hardware | 10 CPU / 16 GiB | 10 CPU / 16 GiB | 8 CPU / 16 GiB |
| macOS | 15.7.4 | 15.6.1 | 15.6.1 |
| OrbStack | 2.2.1 | 2.2.0 | missing |
| Docker | 29.4.0 / OrbStack | 29.4.0 / OrbStack | missing |
| pinned toolchain | Node 25.8.0 / Codex 0.145.0 | missing; user PATH has Node 25.8.1 / Codex 0.145.0 | missing |
| `_cecelia` UID/GID 450 | present | missing | missing |
| Fleet Worker | system LaunchDaemon healthy | missing | missing |
| legacy Codex bridge | GUI LaunchAgent files present, not the Fleet authority | GUI LaunchAgent running | process present; no Fleet authority |
| callback to US Brain | reachable | reachable | reachable |
| Tailscale CLI in Worker PATH | `/opt/homebrew/bin/tailscale` | `/opt/homebrew/bin/tailscale` | app exists, CLI missing from PATH |
| Worker token | protected file, mode 0600 | missing | missing |
| declared base capacity | 7 | 8 | 8 |
| role capacity | light 7; proposer 3; heavy 1 | light 8; proposer 4; heavy 2 | light 8; proposer 4; heavy 2 |

`light = commander/planner/reviewer/reporter` (weight 1),
`proposer` has weight 2, and `heavy = generator/evaluator/judge` has weight 4.
US reserves control-plane capacity; Xian nodes have no Brain control plane.

The current production Runner state is drifting in three directions:

- repository NodeProfile/rollout still pins `sha256:72afb…3f36`;
- US Fleet Worker runs `sha256:9fc98…344d`;
- the floating `cecelia/runner:latest` tag was rebuilt from obsolete source.

The authoritative `origin/main@9466c380` image built for this phase is:

```text
sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7
```

Its `/usr/local/bin/entrypoint.sh` SHA-256 equals the tracked source SHA-256
`0388441c…8d0de`, and it contains Codex 0.145.0 plus the Commander Phase 2
provider contract. Phase 4A only distributes and verifies this immutable
artifact; it does not change its Phase 2 behavior.

## Independent PR file boundary

Create:

- `docs/superpowers/plans/2026-07-28-provider-neutral-harness-phase-4a-production.md`

Modify:

- `packages/brain/config/fleet-node-profiles.json`
- `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`
- `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- `packages/brain/scripts/fleet-worker/fleet-rollout.sh`
- `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- `packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh`
- `packages/quality/smoke-allowlist.txt`
- `DoD.md`
- `regression-contract.yaml`
- `.brain-versions`
- `DEFINITION.md`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- `package-lock.json`

Do not modify:

- `workspace-manager.cjs`, `attempt-runner.cjs`, or `WorkspaceSpec`;
- `credential-envelope.cjs`, credential Broker, or provider auth loading;
- receipt, attestation, reconcile/recovery, watchdog, or failure classification;
- Commander contracts, coordinator, memory, Directive logic, or `derive.js`;
- synthetic/real canary code.

## Task 1: Freeze the complete Phase 4A Red oracle

**Files:**

- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`

- [ ] Add a NodeProfile test that requires every profile and both deployment
  scripts to pin
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`.
- [ ] Add admission cases proving macOS `15.7.8` satisfies the shared
  `15.7.4` floor, while `15.6.1` fails with `os_version_below_floor`.
- [ ] Add a baseline reconciler case with only
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale`; require the committed
  toolchain to expose executable `bin/tailscale`.
- [ ] Add a rollout contract assertion that the archive exporter uses the same
  immutable digest as NodeProfile.
- [ ] Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-profile.test.js \
  src/orchestrator/fleet-node/node-admission.test.js
cd ../..
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
```

Expected Red signatures:

```text
expected sha256:72afb… to be sha256:5a4c…
expected base_admitted true for 15.7.8, received os_version_drift
missing toolchain/bin/tailscale
rollout still exports sha256:72afb…
```

- [ ] Commit only tests and this plan:

```bash
git add docs/superpowers/plans/2026-07-28-provider-neutral-harness-phase-4a-production.md \
  packages/brain/src/orchestrator/fleet-node/node-profile.test.js \
  packages/brain/src/orchestrator/fleet-node/node-admission.test.js \
  packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh \
  packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
git commit -m "test(fleet): freeze Phase 4A production convergence (Red)"
```

## Task 2: Align the immutable Runner and macOS floor

**Files:**

- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.sh`
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`

- [ ] Replace every production pin with the `5a4c…807e7` digest.
- [ ] Treat the shared `version_policy.os` as an exact major/minor and minimum
  patch floor. Reject unparsable versions, major/minor changes, and lower
  patches; return `os_version_below_floor` for `15.6.1`.
- [ ] Keep OrbStack, Worker, Runner, Git, Node, Codex, protocol, and contract
  versions exact.
- [ ] Run the two Vitest Red families; expect Green.
- [ ] Commit:

```bash
git add packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/src/orchestrator/fleet-node/node-admission.js \
  packages/brain/scripts/fleet-worker/fleet-rollout.sh \
  packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh \
  packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
git commit -m "feat(fleet): align Phase 4A node baseline"
```

## Task 3: Make Tailscale available to the system Worker

**Files:**

- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`

- [ ] Resolve Tailscale from the dedicated toolchain, current PATH, or the
  official app binary, in that order.
- [ ] Link the verified executable into
  `/usr/local/libexec/cecelia/toolchain/bin/tailscale`; never copy identity,
  state, keys, or user home content.
- [ ] Fail closed with `tailscale_command_unavailable` if no executable exists.
- [ ] Run the reconciler shell Red family; expect Green.
- [ ] Commit:

```bash
git add packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh
git commit -m "fix(fleet): expose Tailscale to LaunchDaemon"
```

## Task 4: Version, definitions, and verification

**Files:**

- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `DoD.md`
- Modify: `regression-contract.yaml`

- [ ] Bump Brain `1.267.99` to `1.267.100` and document rollback to
  `1.267.99`.
- [ ] Record the as-built drift, immutable Runner pin, minimum macOS patch
  semantics, Tailscale command boundary, and no-credential rule.
- [ ] Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-profile.test.js \
  src/orchestrator/fleet-node/node-admission.test.js \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/preflight/capability-gate.test.js \
  src/orchestrator/preflight/production-wiring.test.js \
  scripts/fleet-worker/fleet-worker.test.js
cd ../..
bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
node scripts/devgate/scan-rci-coverage.cjs
bash scripts/devgate/require-rci-update-if-p0p1.sh
git diff --check
```

- [ ] Self-review the exact diff, verify it contains no auth material, push the
  branch, open one PR, and follow CI to all required checks passing.
- [ ] Squash merge only that PR.

## Task 5: Production rollout after merge

- [ ] Fast-forward the dedicated clean deployment checkout to the merge SHA.
- [ ] Tag the verified local image by immutable digest and retain the source
  entrypoint SHA evidence.
- [ ] Drain one Xian node at a time; install the latest Sequoia `15.7.x`
  security patch when it is below the `15.7.4` floor, then reconnect after the
  explicit restart.
- [ ] From `us-mac-m4`, run the committed `fleet-rollout.sh --apply` for US,
  Xian M4, and Xian M1. It copies only the Worker bearer token and
  credential-free Git/Runner artifacts; it must never copy a Codex home.
- [ ] Require each node to report:

```text
base_admitted=true
dispatch_ready=true
launchd.domain=system
launchd.kind=LaunchDaemon
runner.image_digest=sha256:5a4c…807e7
docker.available=true
worktree.root_ready=true
container.probe_succeeded=true
callback.reachable=true
drain.active=false
```

- [ ] Confirm Xian M4 can serve `:5231/health` with its user logged out; the
  old GUI Codex bridge may remain as rollback inventory but is not a Fleet
  dependency.
- [ ] Stop. Do not run Phase 5 or claim the full Commander/Fleet PRD complete.
