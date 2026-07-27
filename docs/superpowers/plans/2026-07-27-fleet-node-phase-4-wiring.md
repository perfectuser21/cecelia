# Fleet Node Phase 4 Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the existing Kernel Fleet execution-plane gaps in four independently reviewable PRs, beginning with a fail-closed Fleet Node Contract and base-admission layer.

**Architecture:** Keep Brain Control Plane and Kernel Run Controller on `us-mac-m4`. Phase 4A freezes the node contract and base-admission evidence; Phase 4B makes every machine execute through one Worker API with Worker-owned workspaces; Phase 4C injects one centrally selected credential per Attempt; Phase 4D proves execution and recovery equivalence. Existing receipt, attestation, watchdog, and synthetic-canary code remains intact.

**Tech Stack:** Node.js ESM/CommonJS, macOS launchd, OrbStack/Docker, Git worktrees, Vitest, `node:test`, shell contract tests, Cecelia DevGate.

---

## Production baseline

- Base: `origin/main@6b9446e81`
- Brain: `1.267.89`
- Existing local transport: `local-docker`
- Existing Xian transport: `remote-bridge` running host Codex
- Pinned starting Runner digest:
  `sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36`
- Live 2026-07-27 evidence:
  - `us-mac-m4`: Brain healthy; local Runner digest above exists.
  - `xian-mac-m4`: Bridge healthy; `docker_available=true`.
  - `xian-mac-m1`: Bridge healthy; `docker_available=false`.
  - Capacity endpoint confidence is `theoretical`, sample size `2`.

The synthetic Fleet canary is transport evidence only. It is not a substitute for the
Phase 5 real task that produces a code diff, Red/Green commits, PR, CI, and verdict.
Phase 4A may return `base_admitted`, but it must always return
`dispatch_ready=false`. Credential-envelope acceptance, serial canary composition, and
execution-equivalence evidence remain explicit closed gates for Phases 4C–4D; Phase 4A
cannot imply final dispatch readiness.

## Dependency graph

```text
Phase 0B capability/fallback + Phase 0C telemetry + Phase 3 transport/receipt
                                │
                                ▼
Phase 4A Fleet Node Contract and admission
  NodeProfile + pinned Runner + system LaunchDaemon + self-check + weighted capacity
                                │
                                ▼
Phase 4B unified Worker API and isolated WorkspaceSpec
  US/Xian same API + per-Attempt worktree/container + cleanup/quarantine
                                │
                                ▼
Phase 4C central Credential Broker
  one CredentialEnvelope/Attempt + tmpfs + one consumption + no Xian local fallback
                                │
                                ▼
Phase 4D execution equivalence and failure closure
  same execution inputs/results + health TTL + failure classes + restart/recovery
                                │
                                ▼
Phase 5 real mixed-machine task and One-session versus Kernel A/B
```

Phase 4C depends on the container and lifecycle boundary created in 4B. Phase 4D depends
on 4A through 4C. No Phase may cherry-pick an unreviewed commit from a later Phase.

## PR file boundaries

### Phase 4A PR: Fleet Node Contract and admission

Create:

- `packages/brain/config/fleet-node-profiles.json`
- `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission-client.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission-client.test.js`
- `packages/brain/scripts/fleet-worker/node-probe.cjs`
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template`
- `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker-docker-access.plist.template`
- `packages/brain/scripts/fleet-worker/refresh-fleet-worker-docker-access.sh`
- `packages/brain/scripts/fleet-worker/fleet-worker-docker-access.test.sh`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- `packages/brain/scripts/fleet-worker/fleet-nodectl.sh`
- `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`
- `packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh`

Modify:

- `packages/brain/src/orchestrator/preflight/production-probes.js`
- `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- `docker-compose.yml`
- `regression-contract.yaml`
- `docs/registry/features/orchestration.yml`
- `packages/quality/smoke-allowlist.txt`
- `DoD.md`
- `package-lock.json`
- `.brain-versions`
- `DEFINITION.md`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`

Do not modify in 4A:

- Attempt request/callback schemas
- `WorkspaceSpec`
- `kernel-attempt-handler.cjs`
- credential loading or auth material
- `derive.js`, receipt, attestation, watchdog, or canary state

### Phase 4B PR: unified Worker API and isolated Workspace

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
- `packages/brain/src/orchestrator/execution-contract.test.js`
- `packages/brain/src/orchestrator/production-transport.js`
- `packages/brain/src/orchestrator/production-transport.test.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- `packages/brain/src/docker-executor.js`
- `packages/brain/src/__tests__/docker-executor.test.js`
- `packages/brain/scripts/codex-bridge/codex-bridge.cjs`
- `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`
- `packages/brain/scripts/codex-bridge/com.perfect21.cecelia-fleet-worker.plist.template`
- version, Definition, RCI, and smoke registration files

Red tests:

- `WorkspaceSpec rejects absolute cwd and non-canonical SHA`
- `Worker creates two concurrent writer Attempts in different worktrees`
- `read-only role cannot write through its outer mount`
- `terminal callback removes container and worktree`
- `failed cleanup quarantines the workspace`
- `US Attempt contacts Worker API instead of local Docker directly`
- `restart reconciles orphan container/worktree without deleting another Attempt`

### Phase 4C PR: central Credential Broker

Create:

- `packages/brain/src/orchestrator/credential-envelope.js`
- `packages/brain/src/orchestrator/credential-envelope.test.js`
- `packages/brain/src/orchestrator/credential-broker.js`
- `packages/brain/src/orchestrator/credential-broker.test.js`
- `packages/brain/migrations/366_kernel_credential_envelopes.sql`
- `packages/brain/src/orchestrator/credential-envelope-migration.test.js`
- `packages/brain/scripts/smoke/kernel-credential-envelope-smoke.sh`

Modify:

- `packages/brain/src/orchestrator/dispatcher.js`
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- `packages/brain/src/orchestrator/production-transport.js`
- `packages/brain/src/orchestrator/production-transport.test.js`
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`
- `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`
- both legacy Bridge plist inputs to remove account allowlists
- version, Definition, RCI, and smoke registration files

Red tests:

- `CredentialEnvelope rejects attempt, machine, account, or expiry mismatch`
- `Broker emits one selected account and no sibling account material`
- `Worker consumes an envelope exactly once`
- `auth.json exists only on container tmpfs with mode 0600`
- `callback, receipt, logs, and database metadata contain no token`
- `credential copy mutation returns only credential_copy_mutated=true`
- `missing envelope fails closed and never calls loadRawAuth`
- `Worker never writes a changed token back to US M4`

### Phase 4D PR: execution equivalence and failure closure

Create:

- `packages/brain/src/orchestrator/execution-equivalence.js`
- `packages/brain/src/orchestrator/execution-equivalence.test.js`
- `packages/brain/src/orchestrator/worker-health.js`
- `packages/brain/src/orchestrator/worker-health.test.js`
- `packages/brain/scripts/smoke/fleet-restart-recovery-smoke.mjs`

Modify:

- `packages/brain/src/orchestrator/providers/shared.js`
- `packages/brain/src/orchestrator/providers/shared.test.js`
- `packages/brain/src/orchestrator/preflight/production-probes.js`
- `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- `packages/brain/src/orchestrator/preflight/capability-gate.js`
- `packages/brain/src/orchestrator/preflight/capability-gate.test.js`
- `packages/brain/src/orchestrator/failure-persistence.js`
- `packages/brain/src/orchestrator/failure-persistence.test.js`
- `packages/brain/src/harness-relay-watchdog.js`
- `packages/brain/src/__tests__/harness-relay-watchdog-kernel-fleet.test.js`
- `docker/cecelia-runner/entrypoint.sh`
- `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- version, Definition, RCI, and smoke registration files

Red tests:

- `same fixture yields the same normalized result on all three machine reports`
- `model, role env, Skills digest, tool policy, and timeout drift reject admission`
- `Worker health older than TTL stops new dispatch`
- `provider, account, runner, machine, routing, controller, contract, and unknown failures remain distinct`
- `same-machine recovery may resume only the controlled SessionStore`
- `cross-machine recovery creates a fresh Attempt and never copies provider sessions`
- `Runner, Worker, or Brain restart reclaims one owner and cleans all orphan resources`

## Phase 4A execution plan

### Task 0: Freeze the complete Phase 4A Red oracle

**Files:**

- Create: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-admission-client.test.js`
- Create: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- Create: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- Create: `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`
- Create: `packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh`
- Modify: `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`

- [ ] **Step 1: Write all behavior-first tests**

Freeze the Red cases listed in the Phase 4A PR boundary before creating any production
module, script, plist, Compose variable, registry entry, or version bump. Tests must
call exported behavior or execute the real shell entrypoints; source-string assertions
alone are not an acceptable oracle.

- [ ] **Step 2: Run the complete Red suite**

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
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
```

Expected: every new contract family has a relevant failure because the corresponding
production module, script, or production-probe admission wiring does not exist. Record
the failing test names and failure signatures; syntax errors and fixture errors do not
count as Red evidence.

- [ ] **Step 3: Commit only the Red oracle**

```bash
git add packages/brain/src/orchestrator/fleet-node/node-profile.test.js \
  packages/brain/src/orchestrator/fleet-node/node-admission.test.js \
  packages/brain/src/orchestrator/fleet-node/node-admission-client.test.js \
  packages/brain/scripts/fleet-worker/fleet-worker.test.js \
  packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh \
  packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh \
  packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh \
  packages/brain/src/orchestrator/preflight/production-probes.test.js \
  packages/brain/src/orchestrator/preflight/production-wiring.test.js
git commit -m "test(fleet): freeze node admission contract (Red)"
```

### Task 1: Freeze NodeProfile and fail-closed admission

**Files:**

- Create: `packages/brain/config/fleet-node-profiles.json`
- Create: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`

- [ ] **Step 1: Confirm the frozen contract tests still fail for missing behavior**

```js
import { describe, expect, it } from 'vitest';
import {
  evaluateNodeAdmission,
  roleCapacity,
} from './node-admission.js';

const good = {
  schema: 'fleet-node-report/v1',
  machine_id: 'us-mac-m4',
  observed_at: '2026-07-27T00:01:30.000Z',
  os_version: '15.7.4',
  orbstack_version: '2.1.1',
  worker_version: '1.267.90',
  service_domain: 'system',
  worker_running: true,
  worker_protocol: 'kernel-harness/v1',
  runner_contract: 'cecelia-runner/v1',
  docker_available: true,
  docker_observed_at: '2026-07-27T00:01:30.000Z',
  git_available: true,
  git_version: '2.39.5',
  tailscale_available: true,
  callback_reachable: true,
  time_sync_available: true,
  sleep_disabled: true,
  auto_power_on: true,
  vm_cpu: 6,
  vm_memory_bytes: 8589934592,
  cpu_pressure_pct: 20,
  memory_pressure_pct: 40,
  disk_free_bytes: 50 * 1024 ** 3,
  disk_usage_pct: 40,
  runner_digest: 'sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36',
  worktree_check: true,
  container_check: true,
  drain_marker: false,
};

it('drains a node when the pinned Runner digest drifts', () => {
  const result = evaluateNodeAdmission('us-mac-m4', {
    ...good,
    runner_digest: `sha256:${'0'.repeat(64)}`,
  });
  expect(result).toMatchObject({
    state: 'draining',
    base_admitted: false,
    reasons: expect.arrayContaining(['runner_digest_mismatch']),
  });
});

it('drains a node when Docker, disk, system LaunchDaemon, or worktree fails', () => {
  const result = evaluateNodeAdmission('xian-mac-m1', {
    ...good,
    machine_id: 'xian-mac-m1',
    docker_available: false,
    disk_free_bytes: 30 * 1024 ** 3,
    disk_usage_pct: 90,
    service_domain: 'gui/501',
    worktree_check: false,
  });
  expect(result.reasons).toEqual(expect.arrayContaining([
    'docker_unavailable',
    'disk_free_below_minimum',
    'disk_usage_above_maximum',
    'worker_not_system_launchdaemon',
    'worktree_self_check_failed',
  ]));
});

it('uses role-weighted units instead of one slot per role', () => {
  expect(roleCapacity({ capacity_units: 8 }, 'planner')).toBe(8);
  expect(roleCapacity({ capacity_units: 8 }, 'proposer')).toBe(4);
  expect(roleCapacity({ capacity_units: 8 }, 'generator')).toBe(2);
  expect(roleCapacity({ capacity_units: 8 }, 'evaluator')).toBe(2);
  expect(roleCapacity({ capacity_units: 8 }, 'judge')).toBe(2);
});
```

- [ ] **Step 2: Run Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-profile.test.js \
  src/orchestrator/fleet-node/node-admission.test.js
```

Expected: FAIL because the Fleet Node modules and profile registry do not exist.

- [ ] **Step 3: Add the immutable profile registry**

The JSON registry must contain exactly the canonical IDs `us-mac-m4`,
`xian-mac-m4`, and `xian-mac-m1`; one shared Runner digest; 6 vCPU/8GiB runtime
minimum; 40GiB free/85% usage disk gates; system LaunchDaemon; and capacity units
`7/8/8`. It also freezes the allowed macOS, OrbStack, Worker protocol/version, Runner
contract, Git, Node, and Codex version policy used to reject drift; mutable `latest`
references and empty allowlists are invalid profiles.

- [ ] **Step 4: Implement minimal evaluation**

Export:

```js
export function loadFleetNodeProfiles();
export function getFleetNodeProfile(machineId);
export function evaluateNodeAdmission(machineId, report);
export function roleWeight(role);
export function roleCapacity(profile, role, reservedUnits = 0);
```

Roles map to weights:

```js
{
  commander: 1,
  planner: 1,
  reviewer: 1,
  proposer: 2,
  generator: 4,
  evaluator: 4,
  judge: 4,
}
```

Unknown machine, malformed report, unknown role, missing evidence, stale observation,
or any mismatched hard gate must return `base_admitted=false`; no permissive fallback
is allowed. The Phase 4A evaluator always exposes `dispatch_ready=false` and cannot
produce `true`.

- [ ] **Step 5: Run Green**

Run the Task 1 test command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/src/orchestrator/fleet-node/node-admission.js
git commit -m "feat(fleet): define node admission contract (Green)"
```

### Task 2: Serve bounded, freshly reprobed NodeReport evidence

**Files:**

- Create: `packages/brain/scripts/fleet-worker/node-probe.cjs`
- Create: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- Create: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`

- [ ] **Step 1: Confirm the frozen Worker health tests still fail for missing behavior**

```js
it('reprobes Docker and Runner digest for every health request', async () => {
  const first = await requestHealth({
    machineId: 'us-mac-m4',
    run: fakeRun,
  });
  dockerAvailable = false;
  const second = await requestHealth({
    machineId: 'us-mac-m4',
    run: fakeRun,
  });
  expect(first.report.docker_available).toBe(true);
  expect(second.report.docker_available).toBe(false);
  expect(fakeRun).toHaveBeenCalledWith('docker', expect.any(Array));
});

it('returns only the bounded report and no local account authority', async () => {
  const health = await requestHealth({
    machineId: 'us-mac-m4',
    run: fakeRun,
  });
  const serialized = JSON.stringify(health);
  expect(serialized).not.toMatch(/token|auth\.json|prompt|CODEX_ACCOUNT_ALLOWLIST/);
  expect(serialized).not.toContain('/Users/');
  expect(Object.keys(health.report).sort()).toEqual(REPORT_KEYS);
});
```

- [ ] **Step 2: Run Red**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/fleet-worker.test.js
```

Expected: FAIL because the Fleet Worker health server and probe do not exist.

- [ ] **Step 3: Implement fresh command probes and health-only server**

Use `execFile`/argument arrays only. On every `GET /health`, collect bounded values for
macOS, OrbStack, Docker, VM CPU/memory, disk, Worker launchd domain/state/protocol,
pinned image digest, Git/Tailscale/callback reachability, time sync, sleep/auto-power
baseline, CPU/memory pressure, and a temporary Git worktree/container
create-mount-destroy self-check. Never invoke a shell and never read Provider credential
directories.
Phase 4A Fleet Worker exposes bounded health evidence only; Brain computes
`base_admitted`. It has no Attempt endpoint and cannot claim final dispatch readiness.

- [ ] **Step 4: Run Green and commit**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/fleet-worker.test.js
cd ../..
git add packages/brain/scripts/fleet-worker/node-probe.cjs \
  packages/brain/scripts/fleet-worker/fleet-worker.cjs
git commit -m "feat(fleet): serve bounded node evidence (Green)"
```

### Task 3: Add system LaunchDaemon bootstrap/admission/drain tooling

**Files:**

- Create: `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template`
- Create: `packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker-docker-access.plist.template`
- Create: `packages/brain/scripts/fleet-worker/refresh-fleet-worker-docker-access.sh`
- Create: `packages/brain/scripts/fleet-worker/fleet-worker-docker-access.test.sh`
- Create: `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- Create: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- Create: `packages/brain/scripts/fleet-worker/fleet-nodectl.sh`
- Create: `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`

- [ ] **Step 1: Confirm the frozen shell contracts still fail for missing behavior**

The test must prove:

- default mode is dry-run;
- `--apply` requires root;
- only three canonical machine IDs are accepted;
- install target is `/Library/LaunchDaemons`;
- launch domain is `system`;
- the template includes `RunAtLoad`, `KeepAlive`, explicit `UserName`, bounded log paths,
  `CECELIA_MACHINE_ID`, pinned `CECELIA_RUNNER_DIGEST`, the profile-owned Worker bind
  host, profile-owned `CECELIA_CALLBACK_URL`, and
  `DOCKER_HOST=unix:///var/run/docker.sock`;
- US binds loopback while Xian M4/M1 bind only their exact Tailscale IPs;
- US callback health is local while both Xian callbacks use the canonical US
  Tailscale Brain address;
- `--apply` requires the pre-existing `_cecelia` user and grants only owner-home
  `search` plus exact `docker.sock` `read,write`; it never grants the OrbStack run
  directory or sibling sockets. A root-only WatchPaths helper restores the exact-socket
  ACL after recreation; newly granted ACLs roll back with failed preflight/install;
- no account directory, auth material, token, Prompt, or `CODEX_ACCOUNT_ALLOWLIST` appears;
- `drain` creates the local drain marker before booting out the service;
- `admit` exits non-zero unless the pure contract returns `base_admitted=true`.

- [ ] **Step 2: Run Red**

```bash
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-worker-docker-access.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
```

Expected: FAIL because the template and admin tool do not exist.

- [ ] **Step 3: Implement deterministic commands**

Expose:

```text
fleet-nodectl.sh bootstrap us-mac-m4 [--apply]
fleet-nodectl.sh admit us-mac-m4
fleet-nodectl.sh drain us-mac-m4 [--apply]
fleet-nodectl.sh undrain us-mac-m4 [--apply]
```

`bootstrap` renders but does not silently install OrbStack or credentials. `--apply`
installs the system LaunchDaemon only after OrbStack, Docker, runner digest, disk,
memory, service-user, and bounded socket-access prerequisites pass. `drain` is local and
reversible. No command contacts Xian or changes remote nodes implicitly.

- [ ] **Step 4: Run Green and commit**

```bash
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-worker-docker-access.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
git add packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker.plist.template \
  packages/brain/scripts/fleet-worker/com.cecelia.fleet-worker-docker-access.plist.template \
  packages/brain/scripts/fleet-worker/refresh-fleet-worker-docker-access.sh \
  packages/brain/scripts/fleet-worker/install-fleet-worker.sh \
  packages/brain/scripts/fleet-worker/fleet-nodectl.sh
git commit -m "feat(fleet): add node bootstrap admission and drain tools (Green)"
```

### Task 4: Require fresh admitted-node evidence in production probes

**Files:**

- Create: `packages/brain/src/orchestrator/fleet-node/node-admission-client.js`
- Create: `packages/brain/src/orchestrator/fleet-node/node-admission-client.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-probes.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Confirm the frozen client and wiring tests still fail**

```js
it.each([
  ['missing response', null],
  ['stale evidence', { report: {
    ...goodReport,
    observed_at: '2026-07-27T00:00:00.000Z',
  } }],
  ['mismatched identity', { report: {
    ...goodReport,
    machine_id: 'us-mac-m4',
  } }],
  ['drained node', { report: {
    ...goodReport,
    drain_marker: true,
  } }],
])('fails closed on %s', async (_case, response) => {
  const client = createNodeAdmissionClient({
    workerUrls: { 'xian-mac-m4': 'http://worker:3459' },
    fetchFn: responseFetch(response),
    now: () => Date.parse('2026-07-27T00:02:00.000Z'),
    ttlMs: 90_000,
  });
  await expect(client.getAdmission('xian-mac-m4')).resolves.toMatchObject({
    base_admitted: false,
  });
});

it('production machine health always requires base admission', async () => {
  const probes = createProductionCapabilityProbes({
    nodeAdmissionClient: {
      getAdmission: vi.fn(async () => ({
        base_admitted: false,
        reasons: ['docker_unavailable'],
      })),
    },
    // existing Brain Fleet dependencies
  });
  await expect(probes.getMachineHealth({
    machine: 'xian-mac-m1',
  })).resolves.toMatchObject({
    ok: false,
    signature: 'node_not_base_admitted',
  });
});
```

- [ ] **Step 2: Run Red**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/preflight/production-wiring.test.js
```

Expected: FAIL because production probes still trust `online/effective_slots` alone.

- [ ] **Step 3: Implement the bounded client and mandatory gate**

Map canonical machine IDs to server-owned Worker URLs. The client fetches the bounded
Worker report and evaluates it against the Brain-owned immutable NodeProfile; it never
trusts a Worker-supplied admission boolean. Production probes must always reject missing
URL, missing response, stale, malformed, mismatched, or drained evidence; there is no
online/slot-only fallback and no default-off enforcement switch. Compose provides only
the three server-owned Worker URLs and the bounded TTL. Deployment order is Worker-first
on all nodes, then Brain; if any Worker is absent, Brain keeps that node closed.
Capacity probes must also require `task_bundle.role`, cap live effective/physical slots
at the canonical NodeProfile capacity, then convert both to role units. Missing or
unknown roles fail closed; the production-reachable reporter role is explicitly weight 1.

- [ ] **Step 4: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/preflight/production-wiring.test.js
cd ../..
git add packages/brain/src/orchestrator/fleet-node/node-admission-client.js \
  packages/brain/src/orchestrator/preflight/production-probes.js \
  docker-compose.yml
git commit -m "feat(fleet): enforce fresh node admission evidence (Green)"
```

### Task 5: Register durable regression and Brain version

**Files:**

- Create: `packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh`
- Modify: `regression-contract.yaml`
- Modify: `docs/registry/features/orchestration.yml`
- Modify: `packages/quality/smoke-allowlist.txt`
- Modify: `DoD.md`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`

- [ ] **Step 1: Run the frozen smoke against the Green contract**

The smoke invokes real contract code against:

1. one valid bounded report and expects `base_admitted`;
2. one M1 report with `docker_available=false` and expects `draining`;
3. one report with the wrong Runner digest and expects `draining`;
4. role capacity `8 → planner 8 / proposer 4 / generator 2`.

This is a contract regression, not Phase 5 business acceptance.

- [ ] **Step 2: Verify Green**

```bash
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
```

Expected: PASS against the implemented contract. The earlier `(Red)` commit contains
the recorded missing-implementation failure.

- [ ] **Step 3: Register RCI and version**

Add the smoke to `regression-contract.yaml` as a P0 `must_never_break` golden path, add
the new files/tests to `provider_neutral_harness` in
`docs/registry/features/orchestration.yml`, register it in the smoke allowlist, and bump
Brain from `1.267.89` to `1.267.90` in all four version sources plus `.brain-versions`.
Update both Definition files with the Node Contract behavior.

- [ ] **Step 4: Run Green and commit**

```bash
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
git add packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh \
  regression-contract.yaml docs/registry/features/orchestration.yml \
  packages/quality/smoke-allowlist.txt DoD.md package-lock.json \
  .brain-versions DEFINITION.md \
  packages/brain/DEFINITION.md packages/brain/package.json \
  packages/brain/package-lock.json
git commit -m "docs(fleet): register node admission regression and version"
```

### Task 6: Phase 4A verification and unmerged PR

- [ ] **Step 1: Run focused tests**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-profile.test.js \
  src/orchestrator/fleet-node/node-admission.test.js \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/preflight/capability-gate.test.js \
  src/orchestrator/preflight/production-wiring.test.js \
  scripts/fleet-worker/fleet-worker.test.js \
  src/__tests__/fleet-resource-cache.test.js \
  src/__tests__/capacity-endpoint.test.js \
  src/__tests__/codex-bridge-health.test.js
cd ../..
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh
bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh
```

Expected: all PASS.

- [ ] **Step 2: Run repository gates**

```bash
node scripts/devgate/check-new-api-endpoints.mjs
node packages/engine/scripts/devgate/check-dod-purity.cjs
bash scripts/ci/check-branch-naming.sh cp-07270814-fleet-node-admission-4a
bash scripts/check-version-sync.sh
BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
bash .github/workflows/scripts/lint-tdd-commit-order.sh origin/main
bash .github/workflows/scripts/lint-test-quality.sh origin/main
bash .github/workflows/scripts/lint-no-mock-only-test.sh origin/main
bash .github/workflows/scripts/lint-no-fake-test.sh origin/main
bash scripts/ci/run-core-regression.sh --tier pr
git diff --check origin/main...HEAD
```

Expected: all PASS.

- [ ] **Step 3: Review scope**

```bash
git diff --name-only origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

Expected: only the Phase 4A file set above. No WorkspaceSpec, credential, callback,
receipt, attestation, watchdog, canary, or Commander state changes.

- [x] **Independent review closure: post-start generation verification**

The installer now commits a replacement generation only after launchd reports the
Worker as running and the profile-owned `/health` endpoint returns the matching
machine identity. A `kickstart` success followed by process exit, listener bind
failure, or health failure takes the existing transactional rollback path. Red
commit `e92e004db`; Green commit `4c333db64`.

- [ ] **Step 4: Push and open an unmerged PR**

```bash
git push -u origin cp-07270814-fleet-node-admission-4a
gh pr create --base main --head cp-07270814-fleet-node-admission-4a \
  --title "feat(fleet): add fail-closed node admission contract" \
  --body-file /tmp/fleet-node-admission-pr-body.md
```

The PR body must include the plan path, Red and Green evidence, live facts showing M1
currently fails Docker admission, the exact rollback, and the statement that no real
business canary has yet passed. Keep the PR OPEN and stop for independent review.
