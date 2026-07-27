# Fleet Node Self-Deploy Design

**Date:** 2026-07-27
**Scope:** Phase 4A only
**PR:** #4367

## Goal

Cecelia must be able to bootstrap the three macOS Fleet nodes without asking a
human to log in and install software. The shared machine baseline comes from
the US M4 contract, while machine identity, Tailscale address, callback address,
and capacity remain explicit per-node overlays.

This closes a Phase 4A gap. The existing implementation verifies OrbStack,
Docker, the `_cecelia` service account, a Git worktree root, and the pinned
Runner image, but it does not create or distribute them.

## Non-goals

- Do not enter Phase 4B Worker attempt execution or WorkspaceSpec.
- Do not add credential brokering from Phase 4C.
- Do not copy a user home, Tailscale identity, SSH private key, Codex auth
  directory, token, Prompt, provider session, or dirty repository state.
- Do not treat a synthetic canary as real-task acceptance.
- Do not deploy an unmerged PR.
- Do not silently reboot a production Mac while reconciling Phase 4A.

## Runtime boundary

OrbStack remains the only container runtime. LaunchDaemon does not replace it.

```text
US M4 Cecelia control plane
  └── Fleet rollout over SSH
        └── node-local baseline reconciler (root)
              ├── pinned Node/Codex toolchain
              ├── OrbStack/Docker
              ├── _cecelia service identity
              ├── credential-free Git baseline
              ├── pinned Runner image
              └── Fleet Worker system LaunchDaemon
```

## Golden baseline

The declarative NodeProfile remains the admission authority. All three profiles
must have identical shared resources, launchd policy, Runner digest, and version
policy. Only these fields may differ:

- `machine_id`
- `capacity`
- `worker_bind_host`
- `brain_health_url`

The approved common runtime baseline is:

| Component | Version/source |
|---|---|
| macOS | `15.7.4` |
| OrbStack | `2.2.1` |
| Node.js | `25.8.0` |
| Codex CLI | `0.145.0` |
| Git | Apple Git `2.39.5` |
| Worker | `1.267.90` |
| Runner | existing pinned digest `sha256:72afb...3f36` |

OrbStack is raised from the US M4's observed `2.1.1` to the current approved
`2.2.1` before rollout. This avoids downgrading Xian M4 from `2.2.0`; OrbStack's
own documentation says downgrades are unsupported. The artifact is the official
Apple Silicon DMG:

- URL:
  `https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.1_20628_arm64.dmg`
- SHA-256:
  `5bc1719c3c987c4c60c65be9fdd65b4730990e1697ec1cb1c33e6bba31bf92b5`

The pinned Node.js artifact is:

- URL:
  `https://nodejs.org/dist/v25.8.0/node-v25.8.0-darwin-arm64.tar.gz`
- SHA-256:
  `75ff6fd07e0a85fb4d2529f6189c996014b1d3d83180c31e65feb2b3eaeec5d9`

Codex CLI is installed into the dedicated toolchain prefix as
`@openai/codex@0.145.0`. No auth material is installed with it.

## Components

### Node-local baseline reconciler

`reconcile-fleet-node-baseline.sh` is local-only and dry-run by default.
`--apply` requires root and a canonical machine ID.

It performs these idempotent operations:

1. Validate Apple Silicon and the canonical profile.
2. Create a locked `_cecelia` group/user at UID/GID 450 when absent; fail if
   either ID is owned by another record.
3. Install the pinned Node.js toolchain beneath
   `/usr/local/libexec/cecelia/toolchain`, verify the SHA-256 before placement,
   and install the pinned credential-free Codex CLI.
4. Install or upgrade OrbStack to the approved version, start it headlessly,
   and verify both `orbctl version` and Docker availability.
5. Import the Git bundle into a `_cecelia`-owned bare repository at
   `/var/lib/cecelia/repository`.
6. Load the Runner archive and verify the exact image digest.
7. Invoke the existing transactional Fleet Worker installer.

An OrbStack version newer than the baseline is not downgraded. The node remains
drained and reports `orbstack_newer_than_baseline` so the baseline can be
reviewed and advanced.

### US M4 rollout controller

`fleet-rollout.sh` is dry-run by default and may apply only when the controller
identity is `us-mac-m4`.

For each node it builds artifacts only from the committed Git object graph:

- a tracked-source archive containing the Phase 4A installer;
- a Git bundle rooted at the rollout commit;
- a Docker archive of the pinned Runner image.

The controller resolves one immutable commit OID before artifact creation. Both
the source archive and a temporary bare repository used to create the bundle
are populated from that OID. It rechecks HEAD and the complete worktree before
transport; any change aborts without contacting a node.

It sends those files over SSH and streams them through `sudo -n` into a fresh,
root-owned `/var/tmp` staging directory. The node-local reconciler and its input
artifacts execute only from that root-owned staging directory, never from an SSH
user-writable path. Before execution, local and remote controllers require the
staging directory to be root-owned mode 0700 and require the staged controller
and nodectl to be root-owned regular non-symlink files with no group/world write
bits. The internal apply mode requires EUID 0, repeats that validation, executes
the canonical staged nodectl directly as root, and exposes neither nested sudo
nor a production nodectl override. It never invokes Cecelia Bridge `/run` and
never reads or sends a Codex account directory.

Canonical targets:

| Machine | Transport target |
|---|---|
| `us-mac-m4` | local |
| `xian-mac-m4` | `jinnuoshengyuan@100.86.57.69` |
| `xian-mac-m1` | `xx-macmini@100.88.166.55` |

`all` uses this maintenance order:

1. `xian-mac-m4`
2. `us-mac-m4`
3. `xian-mac-m1`

The controller creates the drain marker before changing runtime state. After
bootstrap it removes the marker only long enough to obtain fresh admission
evidence. If admission fails, it immediately restores drain and exits non-zero.
HUP, INT, TERM, or an unexpected exit after undrain also restores drain.
The public local/SSH entrypoint forwards those signals to the node transaction;
signal relay failure, interruption during cleanup, and partial root staging
deletion use a fixed system drain marker and launchd label independent of staged
files, then return non-zero.
Phase 4A still reports `dispatch_ready=false`; production probes require final
dispatch readiness, so no Attempt becomes runnable. The capability gate
preserves `node_not_dispatch_ready` in its result, alert, and decision evidence.

## macOS maintenance boundary

Both Xian nodes currently report macOS `15.6.1`, while the contract requires
`15.7.4`. A macOS update may reboot the machine and is not folded into the same
transaction as OrbStack and Worker installation.

The reconciler records the drift, continues installing the non-rebooting
baseline, and admission keeps the node drained. After PR merge, Cecelia performs
the macOS maintenance sequentially and reruns rollout/admission. The human does
not need to log in, but Phase 4A does not hide a reboot inside `--apply`.

## Failure and rollback rules

- Default invocation is read-only.
- Root and controller identity checks occur before mutation.
- Downloads are verified before placement.
- Existing exact-version artifacts are reused.
- Existing newer OrbStack is never downgraded.
- Git input contains committed objects only.
- Runner import must resolve to the pinned digest.
- OrbStack's pinned `orbctl` and `docker` commands are linked into the Worker
  toolchain PATH before the real installer preflight.
- Worker installation retains its existing transactional rollback.
- Any failure leaves or restores the node drain marker.
- No node is considered ready from Worker-supplied booleans; Brain-owned
  admission remains authoritative.

## Verification

Automated tests must prove:

- shared profile fields are identical across all three machines;
- dry-run causes no local or remote mutation;
- missing prerequisites are installed from pinned, checksum-verified artifacts;
- service identity collisions fail closed;
- tracked Git and Runner artifacts are transferred without credential paths;
- rollout target mapping and `all` order are exact;
- SSH or admission failure leaves the node drained;
- local and remote privileged execution uses root-owned staging only;
- source commit/worktree drift stops before transport;
- non-root, writable, or symlinked privileged staging stops before execution;
- public-entry interruption or cleanup failure after undrain restores drain;
- a successful Phase 4A rollout remains `dispatch_ready=false`;
- existing Fleet Node admission and production wiring tests remain green.

Production acceptance occurs only after PR review and merge:

1. Each machine reports the canonical physical identity.
2. OrbStack/Docker and the Worker system LaunchDaemon are healthy.
3. The pinned Runner container probe succeeds.
4. Brain-owned base admission succeeds.
5. The actual machine remains observable in health evidence.

This is infrastructure acceptance only. A real Planner→Generator→Evaluator→PR
task remains required later; synthetic transport output is not a substitute.
