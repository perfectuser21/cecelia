# Codex Relay Four-Way Headless Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely run four simultaneous headless One Session Codex controllers on US M4 using the same team1 credentials, with independent host-visible credential snapshots and exact cleanup.

**Architecture:** Keep `initiative_runs` as the durable total-active ledger and replace the broken permanent scalar with a transient total launch reservation. Add a small credential-snapshot module keyed by unique container ID, then invoke its exact cleanup on launch failure and relay callback.

**Tech Stack:** Node.js ESM, Vitest, Express, PostgreSQL, Docker Compose, shell smoke tests.

---

## File Map

- Create `packages/brain/src/codex-relay-credentials.js`: host-visible snapshot root, isolated copy, and validated exact cleanup.
- Modify `packages/brain/src/harness-skill-relay.js`: total-four reservation/DB gate, unique Codex run identity, snapshot lifecycle integration.
- Modify `packages/brain/src/routes/harness-callback.js`: exact per-container snapshot cleanup before relay acknowledgement.
- Modify `packages/brain/src/harness-relay-watchdog.js`: exact no-callback cleanup after a successful overdue-to-failed transition.
- Replace `packages/brain/src/__tests__/harness-skill-relay-account-buckets.test.js`: approved same-team1 total-four contract.
- Modify `packages/brain/src/__tests__/harness-relay-watchdog.test.js`: task-scoped cleanup and lost-race regression.
- Modify `packages/brain/src/routes/__tests__/harness-callback.test.js`: callback cleanup regression.
- Modify `packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh`: host-visible root and exact cleanup behavior.
- Modify `docker-compose.yml`: change `CODEX_RELAY_HOME` default from team2 to the already mounted team1; do not add mounts.
- Modify `DEFINITION.md`, `packages/brain/VERSION`, `packages/brain/package.json`, `packages/brain/package-lock.json`: synchronized Brain patch version.

### Task 1: Replace the rejected Red contract

**Files:**
- Modify: `packages/brain/src/__tests__/harness-skill-relay-account-buckets.test.js`

- [ ] **Step 1: Replace per-account and team2–5 tests with total-four tests**

Use four tasks that all have `executor='codex'` and no account allocator. Inject
a blocked `spawnFn` so all launch reservations coexist:

```js
let release;
const launchBarrier = new Promise((resolve) => { release = resolve; });
const spawnFn = vi.fn(() => launchBarrier);
const launches = [1, 2, 3, 4].map((n) =>
  spawnSkillRelaySession(codexTask(n), makeDeps({ spawnFn })));
await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(4));
const fifth = await spawnSkillRelaySession(codexTask(5), makeDeps({ spawnFn }));
expect(fifth).toMatchObject({
  ok: false,
  deferred: true,
  reason: 'codex_concurrent_limit',
});
release({ containerId: 'released' });
expect((await Promise.all(launches)).every((result) => result.ok)).toBe(true);
```

Add DB boundary cases:

```js
it.each([
  ['0 active', '0', true],
  ['3 active', '3', true],
  ['4 active', '4', false],
])('%s', async (_label, count, allowed) => {
  const deps = makeDeps({ pool: poolWithActiveCount(count) });
  const result = await spawnSkillRelaySession(codexTask(1), deps);
  expect(result.ok).toBe(allowed);
});
```

Assert four successful runs have four distinct `containerId` values, callback
URLs, snapshot keys, and `ensureWt` task inputs. Assert compose contains only
the existing team1 Codex mount and `CODEX_RELAY_HOME` defaults to team1.

- [ ] **Step 2: Add host-visible snapshot and launch-failure cleanup Red tests**

Set `CODEX_RELAY_SNAPSHOT_ROOT` to a temporary host-visible test directory and
assert:

```js
const snapshot = snapshotCodexRelayHome(source, containerId);
expect(snapshot).toBe(join(hostVisibleRoot, containerId));
expect(statSync(snapshot).mode & 0o777).toBe(0o700);
expect(statSync(join(snapshot, 'auth.json')).mode & 0o777).toBe(0o600);
```

For spawn failure, inject `cleanupCodexHome` and assert it receives the exact
container ID:

```js
expect(cleanupCodexHome).toHaveBeenCalledWith(containerId);
```

- [ ] **Step 3: Run the rewritten contract and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/harness-skill-relay-account-buckets.test.js
```

Expected: failures show the old `> 0` concurrency guard, container-local
snapshot path, non-unique `-cx` container identity, missing exact cleanup, and
team2 default.

- [ ] **Step 4: Commit the approved Red contract**

```bash
git add packages/brain/src/__tests__/harness-skill-relay-account-buckets.test.js
git commit -m "test(brain): define four-way codex relay contract (red)"
```

### Task 2: Implement host-visible credential snapshots

**Files:**
- Create: `packages/brain/src/codex-relay-credentials.js`
- Modify: `packages/brain/src/harness-skill-relay.js`
- Modify: `packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh`

- [ ] **Step 1: Add the credential utility**

Implement:

```js
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function codexRelaySnapshotRoot(env = process.env) {
  return env.CODEX_RELAY_SNAPSHOT_ROOT
    || join(env.HOST_HOME || homedir(), 'claude-output', 'codex-relay-credentials');
}

export function snapshotCodexRelayHome(codexHome, containerId, env = process.env) {
  if (!/^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/.test(containerId)) {
    throw new Error(`invalid codex relay container id: ${containerId}`);
  }
  const auth = join(codexHome, 'auth.json');
  if (!existsSync(auth)) throw new Error(`CODEX_RELAY_HOME 下找不到 auth.json: ${auth}`);
  const root = codexRelaySnapshotRoot(env);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const target = join(root, containerId);
  mkdirSync(target, { mode: 0o700 });
  copyFileSync(auth, join(target, 'auth.json'));
  chmodSync(join(target, 'auth.json'), 0o600);
  const config = join(codexHome, 'config.toml');
  if (existsSync(config)) {
    copyFileSync(config, join(target, 'config.toml'));
    chmodSync(join(target, 'config.toml'), 0o600);
  }
  return target;
}

export function cleanupCodexRelayHome(containerId, env = process.env) {
  if (!/^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/.test(containerId)) return false;
  const root = resolve(codexRelaySnapshotRoot(env));
  const target = resolve(root, containerId);
  if (dirname(target) !== root || basename(target) !== containerId) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

export function cleanupCodexRelaySnapshotsForTask(taskId, env = process.env) {
  const short = String(taskId).replaceAll('-', '').slice(0, 8);
  const matcher = new RegExp(`^cecelia-relay-${short}-cx-[a-f0-9]{8}$`);
  const root = codexRelaySnapshotRoot(env);
  if (!existsSync(root)) return [];
  const removed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !matcher.test(entry.name)) continue;
    if (cleanupCodexRelayHome(entry.name, env)) removed.push(entry.name);
  }
  return removed;
}
```

Re-export `snapshotCodexRelayHome` from `harness-skill-relay.js` to preserve
existing imports.

- [ ] **Step 2: Update the isolation smoke**

Pass a valid container ID, set a temporary `CODEX_RELAY_SNAPSHOT_ROOT`, assert
the returned path is inside it, mutate the snapshot, call
`cleanupCodexRelayHome(containerId)`, and verify the real team1 fixture is
unchanged.

- [ ] **Step 3: Run focused credential tests**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-skill-relay-account-buckets.test.js
cd ../..
bash packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh
```

Expected: snapshot path, modes, and isolation tests pass; concurrency tests
remain Red until Task 3.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/codex-relay-credentials.js \
  packages/brain/src/harness-skill-relay.js \
  packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh
git commit -m "fix(brain): isolate codex relay credentials on host"
```

### Task 3: Implement total-four launch reservation and DB guard

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace the permanent active scalar with transient reservations**

Use:

```js
const MAX_CODEX_RELAYS = 4;
let _codexLaunchReservations = 0;
export function _setActiveCodexRelays(n) {
  _codexLaunchReservations = Number.isInteger(n) && n >= 0 ? n : 0;
}
```

Before asynchronous Codex preparation:

```js
if (_codexLaunchReservations >= MAX_CODEX_RELAYS) {
  return { ok: false, deferred: true, reason: 'codex_concurrent_limit' };
}
_codexLaunchReservations += 1;
let codexReservationHeld = true;
```

Run the DB query and fail closed:

```js
const concQ = await dbPool.query(
  `SELECT COUNT(*) FROM initiative_runs
    WHERE orchestrator_host = 'skill-relay-codex'
      AND phase NOT IN ('done','failed')
      AND deadline_at > NOW()
      AND initiative_id != $1`,
  [initiativeId],
);
const active = Number.parseInt(concQ.rows[0]?.count ?? '0', 10);
if (active + _codexLaunchReservations > MAX_CODEX_RELAYS) {
  return { ok: false, deferred: true, reason: 'codex_concurrent_limit' };
}
```

Release in the function's outer `finally`:

```js
if (codexReservationHeld) {
  _codexLaunchReservations = Math.max(0, _codexLaunchReservations - 1);
}
```

Delete the old post-success increment.

- [ ] **Step 2: Generate unique Codex run identity before snapshot**

Use an injected random source for deterministic tests:

```js
const randomSuffix = (deps.randomFn?.() ?? Math.random())
  .toString(16).slice(2, 10).padEnd(8, '0');
const containerId = isCodex
  ? `cecelia-relay-${short}-cx-${randomSuffix}`
  : existingNonCodexId;
```

Pass `containerId` to `snapshotCodexRelayHome()` and cleanup that same ID on
every error after snapshot creation.

- [ ] **Step 3: Fix production team1 default without adding mounts**

Change only:

```yaml
- CODEX_RELAY_HOME=${CODEX_RELAY_HOME:-${HOME}/.codex-team1}
```

Keep the single existing team1 read-only volume. Do not add team2–5 volumes.

- [ ] **Step 4: Run the approved contract**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-skill-relay-account-buckets.test.js \
  src/__tests__/harness-skill-relay.test.js \
  src/__tests__/headed-dispatch.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-skill-relay.js docker-compose.yml
git commit -m "fix(brain): allow four headless codex relays"
```

### Task 4: Add exact callback cleanup

**Files:**
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/routes/__tests__/harness-callback.test.js`

- [ ] **Step 1: Write callback cleanup Red test**

Mock the credential utility:

```js
vi.mock('../../codex-relay-credentials.js', () => ({
  cleanupCodexRelayHome: vi.fn(() => true),
}));
```

POST a successful relay callback with a valid Codex container ID and assert:

```js
expect(cleanupCodexRelayHome).toHaveBeenCalledWith(containerId);
expect(response.status).toBe(200);
expect(response.body.relayAck).toBe(true);
```

Also make cleanup throw and assert the route still returns 200.

- [ ] **Step 2: Run callback test and verify Red**

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-callback.test.js
```

Expected: cleanup mock has zero calls.

- [ ] **Step 3: Implement best-effort exact cleanup**

Import and invoke:

```js
import { cleanupCodexRelayHome } from '../codex-relay-credentials.js';

if (/^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/.test(containerId)) {
  try {
    cleanupCodexRelayHome(containerId);
  } catch (err) {
    console.warn(`[harness-callback] codex snapshot cleanup failed: ${err.message}`);
  }
}
```

Place it in the relay callback branch before the existing 200 response.

- [ ] **Step 4: Run callback and relay regression tests**

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-callback.test.js \
  src/routes/__tests__/harness-callback-auth-alert.test.js \
  src/__tests__/relay-v101.test.js \
  src/__tests__/harness-skill-relay-account-buckets.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/harness-callback.js \
  packages/brain/src/routes/__tests__/harness-callback.test.js
git commit -m "fix(brain): clean codex relay snapshots on callback"
```

### Task 5: Add watchdog cleanup when callback is lost

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js`
- Modify: `packages/brain/src/__tests__/harness-relay-watchdog.test.js`

- [ ] **Step 1: Write watchdog cleanup Red tests**

Inject `cleanupCodexSnapshotsForTask` into `scanStuckHarness`. For a Codex
overdue row whose terminal update returns `rowCount: 1`, assert exactly:

```js
expect(cleanupCodexSnapshotsForTask).toHaveBeenCalledOnce();
expect(cleanupCodexSnapshotsForTask).toHaveBeenCalledWith(TASK_ID);
```

Repeat with `rowCount: 0` and assert it was not called.

In the credential lifecycle suite, create two matching directories, an
other-task directory, a malformed directory, and a real home outside the
snapshot root. Invoke `cleanupCodexRelaySnapshotsForTask(TASK_ID)` and assert
only the two complete current-task IDs are removed.

- [ ] **Step 2: Run watchdog tests and verify Red**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-skill-relay-account-buckets.test.js
```

Expected: watchdog cleanup injection has zero calls and the cleanup export is
absent.

- [ ] **Step 3: Implement cleanup after the durable terminal transition**

Resolve the dependency once:

```js
const cleanupCodexSnapshotsForTask = opts.cleanupCodexSnapshotsForTask
  || cleanupCodexRelaySnapshotsForTask;
```

Immediately after `if (failedRun?.rowCount === 0) continue;`:

```js
if (row.orchestrator_host === 'skill-relay-codex') {
  try {
    cleanupCodexSnapshotsForTask(row.initiative_id);
  } catch (error) {
    console.warn(
      `[relay-watchdog] codex snapshot terminal cleanup failed ` +
      `initiative=${row.initiative_id}: ${error.message}`,
    );
  }
}
```

The helper enumerates only direct children and calls exact cleanup for complete
matching container IDs. It never passes a filesystem prefix to `rmSync`.

- [ ] **Step 4: Run watchdog and credential tests**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-relay-watchdog-gates.test.js \
  src/__tests__/harness-skill-relay-account-buckets.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-relay-watchdog.js \
  packages/brain/src/__tests__/harness-relay-watchdog.test.js \
  packages/brain/src/__tests__/harness-skill-relay-account-buckets.test.js
git commit -m "fix(brain): clean orphaned codex relay snapshots"
```

### Task 6: Synchronize version and verification contracts

**Files:**
- Modify: `DEFINITION.md`
- Modify: `packages/brain/VERSION`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`

- [ ] **Step 1: Bump Brain patch version**

Increment `1.267.77` to `1.267.78` and write the identical value to:

```text
DEFINITION.md                       **Brain 版本**: 1.267.78
packages/brain/VERSION              1.267.78
packages/brain/package.json         "version": "1.267.78"
packages/brain/package-lock.json    both top-level version fields
```

- [ ] **Step 2: Run version/facts verification**

```bash
node scripts/facts-check.mjs
test "$(cat packages/brain/VERSION)" = \
  "$(node -p "require('./packages/brain/package.json').version")"
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add DEFINITION.md packages/brain/VERSION \
  packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): bump version for codex relay hotfix"
```

### Task 7: Full verification, review, DevGate, and draft PR

**Files:**
- No new production files.

- [ ] **Step 1: Run focused regression and smoke suite**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/harness-skill-relay-account-buckets.test.js \
  src/__tests__/harness-skill-relay.test.js \
  src/__tests__/headed-dispatch.test.js \
  src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-relay-watchdog-gates.test.js \
  src/__tests__/relay-v101.test.js \
  src/routes/__tests__/harness-callback.test.js \
  src/routes/__tests__/harness-callback-auth-alert.test.js
cd ../..
bash packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh
bash packages/brain/scripts/smoke/relay-codex-executor-smoke.sh
```

Expected: all tests and smoke checks pass.

- [ ] **Step 2: Run Brain full unit suite**

```bash
npm test -w packages/brain
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 3: Run DevGate**

```bash
bash scripts/pre-push-check.sh
node packages/engine/scripts/devgate/check-test-coverage.cjs
bash packages/engine/scripts/devgate/check-tdd-commit-order.sh
node packages/engine/scripts/devgate/check-engine-hygiene.cjs
```

Expected: all four commands exit 0.

- [ ] **Step 4: Request code review and address findings**

Review the diff from `origin/main` through `HEAD` against the approved design.
Fix every Critical or Important issue, then rerun affected tests.

- [ ] **Step 5: Verify clean scope**

```bash
git diff --check origin/main...HEAD
git status --short --branch
git diff --stat origin/main...HEAD
```

Expected: clean working tree; only approved files changed.

- [ ] **Step 6: Push and open a draft hotfix PR**

```bash
git push -u origin hotfix/one-session-codex-account-buckets
gh pr create --draft \
  --base main \
  --head hotfix/one-session-codex-account-buckets \
  --title "fix(brain): allow four headless Codex relay controllers" \
  --body-file /tmp/cecelia-codex-relay-four-way-pr.md
```

The body must include root cause, total-four behavior, team1-only scope,
snapshot isolation/cleanup, Red/Green commands, full regression result, and
DevGate result. Do not merge.

- [ ] **Step 7: Inspect CI**

```bash
gh pr checks --watch --fail-fast
```

Report the PR URL and exact check states. Do not merge even if all checks pass.
