# Kernel Fleet Bridge and Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give xian M4 and xian M1 the same authenticated Harness Attempt endpoint, then prove real three-machine serial, parallel and failure behavior.

**Architecture:** Extend the existing Codex Bridge with a separate `/harness/attempts` protocol that executes only allowlisted Codex provider specs and calls the Kernel Attempt callback. Persist Bridge job claims on disk for restart-safe idempotency. Deploy the same code with different canonical machine IDs, then run a no-business-write Canary through the US M4 Kernel.

**Tech Stack:** Node.js CommonJS Bridge, launchd, Codex CLI, HMAC-SHA256, shell/Node smoke tests, Kernel telemetry API.

---

## File map

- Create `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`: authenticated, durable Attempt endpoint.
- Create `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`: true imported handler tests.
- Modify `packages/brain/scripts/codex-bridge/codex-bridge.cjs`: mount endpoint and health evidence.
- Modify both Bridge launchd plists: canonical machine and secret-file configuration.
- Create `packages/brain/scripts/codex-bridge/install-kernel-bridge.sh`: deterministic install/health procedure.
- Create `packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.mjs`: serial/parallel Kernel Canary.
- Create `packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.test.js`: injected transport tests.

### Task 1: Build restart-safe Bridge job claims

**Files:**
- Create: `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`
- Create: `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`

- [ ] **Step 1: Write failing claim tests**

```js
it('returns the same job for the same attempt and lease generation after reload', async () => {
  const first = await handler.accept(request);
  const reloaded = createKernelAttemptHandler({ ...deps, stateDir });
  const second = await reloaded.accept(request);
  expect(second.job_id).toBe(first.job_id);
  expect(spawnFn).toHaveBeenCalledOnce();
});

it('rejects the same attempt with a different lease owner or generation', async () => {
  await handler.accept(request);
  await expect(handler.accept({ ...request, lease_owner: 'attacker' }))
    .rejects.toThrow('attempt_claim_conflict');
});
```

- [ ] **Step 2: Verify Red**

Run `npx vitest run src/__tests__/codex-bridge-kernel-attempt.test.js`.
Expected: missing handler module.

- [ ] **Step 3: Implement atomic claim files**

Store one JSON file per validated UUID under `KERNEL_BRIDGE_STATE_DIR`:

```json
{
  "attempt_id": "uuid",
  "lease_owner": "owner",
  "lease_generation": 0,
  "job_id": "uuid",
  "machine_id": "xian-mac-m4",
  "status": "accepted"
}
```

Write to a same-directory temporary file with mode `0600`, `fsync`, then `renameSync`. On restart, an identical claim returns the stored job; a changed owner/generation returns HTTP 409 and does not spawn.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs \
  packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js
git commit -m "feat(bridge): persist kernel attempt claims"
```

### Task 2: Authenticate and execute allowlisted Codex specs

**Files:**
- Modify: `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`
- Modify: `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`

- [ ] **Step 1: Add Red security tests**

Cover:

- absent/wrong Bearer token → 401;
- target machine differs from `KERNEL_MACHINE_ID` → 409;
- provider other than Codex → 422;
- command not exactly `codex` or `/opt/homebrew/bin/codex` → 422;
- args containing shell metacharacters, `--dangerously-bypass-approvals-and-sandbox`, or non-allowlisted output paths → 422;
- callback URL outside configured Brain origin → 422;
- callback token is never written to job JSON or logs.

- [ ] **Step 2: Verify Red**

Run the Task 1 Vitest command.
Expected: at least the wrong-token and wrong-machine cases currently accept.

- [ ] **Step 3: Implement the execution contract**

Validate the Bridge token with `timingSafeEqual`. Accept only provider `codex` and construct the final process arguments in the Bridge rather than executing arbitrary request arguments:

```js
const args = [
  'exec',
  '--json',
  '--output-schema', schemaPath,
  '--output-last-message', resultPath,
  '--skip-git-repo-check',
  '-',
];
```

Use the requested account only if it is present in the machine-local allowlist. Copy its `auth.json` to the existing temporary isolated CODEX_HOME; never write back to the persistent account directory.

Use `spawn(CODEX_BIN, args, { cwd: WORK_DIR, env, stdio: ['pipe','pipe','pipe'] })`, write the frozen provider stdin, and close stdin. Do not invoke a shell.

- [ ] **Step 4: Normalize the callback**

Parse the provider’s `--output-last-message` as a Harness Result, then overwrite transport-owned metadata:

```js
result.attempt_id = request.attempt_id;
result.provider_metadata = {
  ...result.provider_metadata,
  provider: 'codex',
  machine_id: KERNEL_MACHINE_ID,
  remote_job_id: claim.job_id,
  machine_attestation: sign(
    request.attempt_id,
    KERNEL_MACHINE_ID,
    claim.job_id,
  ),
};
```

POST to the supplied Attempt callback with the per-attempt Bearer token and lease-owner header. Retry callback delivery with bounded exponential backoff; never start a second provider process to repair HTTP delivery.

- [ ] **Step 5: Run Green and commit**

```bash
git add packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs \
  packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js
git commit -m "feat(bridge): execute authenticated kernel codex attempts"
```

### Task 3: Mount launch, inspect and cancel in the existing Bridge

**Files:**
- Modify: `packages/brain/scripts/codex-bridge/codex-bridge.cjs`
- Modify: `packages/brain/src/__tests__/codex-bridge-health.test.js`
- Modify: `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js`

- [ ] **Step 1: Write Red route and health tests**

Assert:

```js
expect(health).toMatchObject({
  kernel_harness_protocol: 'v1',
  canonical_machine_id: 'xian-mac-m4',
});
expect(response.status).toBe(202);
expect(response.body).toMatchObject({
  actual_machine_id: 'xian-mac-m4',
  status: 'accepted',
});
```

- `GET /harness/attempts/:attemptId` returns the persisted job status;
- `POST /harness/attempts/:attemptId/cancel` rejects a different lease owner/generation;
- cancel sends `SIGTERM`, records `cancelled`, and a second cancel is idempotent;
- inspect after process exit returns `completed` or `failed`, never resets to `accepted`.

- [ ] **Step 2: Verify Red**

Run:

```bash
npx vitest run \
  src/__tests__/codex-bridge-health.test.js \
  src/__tests__/codex-bridge-kernel-attempt.test.js
```

Expected: health fields and route are absent.

- [ ] **Step 3: Mount `POST /harness/attempts`**

Instantiate the handler once at process start from:

- `KERNEL_MACHINE_ID`
- `KERNEL_BRIDGE_TOKEN_FILE`
- `KERNEL_BRIDGE_STATE_DIR`
- `BRAIN_URL`
- existing account utilities and Codex binary

Read the token file at startup, require mode no broader than `0600`, and fail startup if the Harness protocol is enabled but configuration is invalid.

Mount the two authenticated lifecycle routes:

```bash
GET  /harness/attempts/:attemptId
POST /harness/attempts/:attemptId/cancel
```

The handler keeps only live child handles in memory; all externally visible job state
comes from the atomic claim file. Cancel validates the stored lease owner and generation,
sends `SIGTERM`, waits five seconds, then sends `SIGKILL` only if the same child is still
alive. It updates the claim to `cancelled` before returning success.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/scripts/codex-bridge/codex-bridge.cjs \
  packages/brain/src/__tests__/codex-bridge-health.test.js \
  packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js
git commit -m "feat(bridge): expose kernel harness attempt protocol"
```

### Task 4: Make xian M4 and M1 deployments identical except identity

**Files:**
- Modify: `packages/brain/scripts/codex-bridge/com.perfect21.codex-bridge.plist`
- Modify: `packages/brain/scripts/codex-bridge/com.perfect21.codex-bridge-m1.plist`
- Create: `packages/brain/scripts/codex-bridge/install-kernel-bridge.sh`
- Create: `packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh`

- [ ] **Step 1: Write Red installer contract tests**

The shell test must prove:

- M4 installs `KERNEL_MACHINE_ID=xian-mac-m4`;
- M1 installs `KERNEL_MACHINE_ID=xian-mac-m1`;
- neither plist embeds a token;
- both point to a `0600` token file;
- M4 allows `team1,team2,team3,team4,team5`;
- M1 allows only `team5`;
- install refuses an unknown machine ID;
- install verifies `/health` canonical machine before returning success.

- [ ] **Step 2: Verify Red**

Run `bash packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh`.
Expected: FAIL because the installer and environment entries do not exist.

- [ ] **Step 3: Implement deterministic installation**

The installer accepts exactly:

```bash
install-kernel-bridge.sh xian-mac-m4 /Users/jinnuoshengyuan/.config/cecelia/kernel-fleet-bridge.token
install-kernel-bridge.sh xian-mac-m1 /Users/xx-macmini/.config/cecelia/kernel-fleet-bridge.token
```

It validates the token file without reading it to stdout, installs the matching plist, runs `launchctl bootstrap`/`kickstart`, then checks:

```bash
case "$machine_id" in
  xian-mac-m4) bridge_ip=100.86.57.69 ;;
  xian-mac-m1) bridge_ip=100.88.166.55 ;;
esac
curl -sf "http://${bridge_ip}:3458/health" |
  jq -e --arg id "$machine_id" \
    '.kernel_harness_protocol=="v1" and .canonical_machine_id==$id'
```

Do not deploy from CI and do not create or rotate production secrets in the repository.
Set `CODEX_ACCOUNT_ALLOWLIST=team1,team2,team3,team4,team5` in the M4 plist and
`CODEX_ACCOUNT_ALLOWLIST=team5` in the M1 plist. The handler must reject an account
outside that machine-local allowlist before creating a claim.

- [ ] **Step 4: Run Green and commit**

```bash
git add packages/brain/scripts/codex-bridge/com.perfect21.codex-bridge.plist \
  packages/brain/scripts/codex-bridge/com.perfect21.codex-bridge-m1.plist \
  packages/brain/scripts/codex-bridge/install-kernel-bridge.sh \
  packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh
git commit -m "feat(bridge): standardize xian kernel bridge installs"
```

### Task 5: Add the three-machine Canary

**Files:**
- Create: `packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.mjs`
- Create: `packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.test.js`

- [ ] **Step 1: Write Red orchestration tests**

Inject a fake Kernel dispatch function and clock. Assert that:

1. serial mode awaits US before M4 and M4 before M1;
2. parallel mode starts all three before resolving any;
3. all Attempt IDs are unique but share one Run ID;
4. strict mode rejects requested/actual mismatch;
5. non-strict failure returns a new Attempt ID;
6. duplicate callbacks do not increase terminal count.

- [ ] **Step 2: Verify Red**

Run `npx vitest run scripts/smoke/kernel-fleet-three-machine-canary.test.js`.
Expected: missing Canary module.

- [ ] **Step 3: Implement dry-run and execute modes**

Default to `--dry-run`. Require all of these for live execution:

```bash
--execute
--run-id "$(uuidgen | tr '[:upper:]' '[:lower:]')"
--brain-url http://localhost:5221
--ack-no-business-writes
```

The live script creates only synthetic Kernel Run/Attempt evidence and uses a read-only objective. It must never merge, push, modify a target worktree, or write business tables.

- [ ] **Step 4: Assert structured evidence**

For each machine, require:

```js
{
  requested_machine_id: machine,
  actual_machine_id: machine,
  machine_attestation_status: machine === 'us-mac-m4' ? 'local' : 'verified',
  status: 'completed',
}
```

Parallel PASS additionally requires overlapping `[started_at, completed_at]` intervals for at least two machines.

- [ ] **Step 5: Run Green and commit**

```bash
git add packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.mjs \
  packages/brain/scripts/smoke/kernel-fleet-three-machine-canary.test.js
git commit -m "test(kernel): add three-machine fleet canary"
```

### Task 6: Review, deploy and execute the real Canary

**Files:**
- Modify Brain version files only if this is a separate PR from the Control Plane plan.

- [ ] **Step 1: Run local regression and DevGate**

```bash
npx vitest run \
  src/__tests__/codex-bridge-health.test.js \
  src/__tests__/codex-bridge-kernel-attempt.test.js \
  scripts/smoke/kernel-fleet-three-machine-canary.test.js
bash packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh
bash scripts/devgate/devgate.sh
```

Expected: all PASS and DevGate exits 0.

- [ ] **Step 2: Open PR and obtain independent review**

The PR description must include Red→Green commands, credential isolation proof, threat cases, and the exact deploy/rollback commands. Keep it unmerged until review PASS and human approval.

- [ ] **Step 3: Deploy in controlled order**

After merge:

1. deploy Brain Control Plane;
2. deploy xian M4 Bridge and verify canonical health;
3. deploy xian M1 Bridge and verify canonical health;
4. leave remote fleet feature flag disabled;
5. run dry-run Canary;
6. enable only the synthetic Canary allowlist.

- [ ] **Step 4: Run serial and parallel live Canary**

Execute serial, parallel, strict-failure and non-strict-fallback cases. Save telemetry JSON and Bridge job evidence in the handoff; do not include secrets.

- [ ] **Step 5: Declare the gate result**

PASS only if all three requested/actual machine pairs match, attestations verify, callbacks are one-per-Attempt, parallel timing overlaps, and fallback creates a new Attempt.

On any mismatch: disable the remote fleet feature flag, keep local Docker unchanged, mark the Canary FAILED, and do not start Commander Phase 1–5.
