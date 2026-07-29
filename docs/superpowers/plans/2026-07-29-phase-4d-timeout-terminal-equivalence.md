# Phase 4D Timeout and Terminal Equivalence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce each authoritative `TaskBundle.constraints.timeout_seconds` inside the pinned Runner for Codex, Claude, and Grok, then return one normalized terminal callback so the Worker can clean the Attempt without an external control-plane cancel.

**Architecture:** Keep the existing Brain → production transport → Fleet Worker → pinned Runner architecture. Brain copies the already-validated timeout into the Worker launch contract; the Worker validates it again and exposes only a numeric `HARNESS_TIMEOUT_SECONDS` environment value; the Runner applies one GNU `timeout` wrapper to all three provider CLIs and normalizes exit 124 as `provider_timeout`. Phase 5 canaries, Provider retries, SessionStore policy, and unrelated recovery behavior remain out of scope.

**Tech Stack:** Node.js ESM/CommonJS, Vitest, Bash, GNU coreutils `timeout`, OrbStack/Docker.

---

## Root cause and PR boundary

The production team4 Attempt `43738522-ba2f-4044-9be4-2fc5768e083e` proved that the TaskBundle carried `timeout_seconds=300`, but `remote-bridge-transport.js` used it only to expire the Codex `CredentialEnvelope`. The Worker launch request, `attempt-runner.cjs` Docker environment, and `entrypoint.sh` provider processes did not carry or enforce it. Heartbeats therefore renewed the lease until the controller's independent 360-second polling deadline cancelled the still-running container.

This PR may modify only:

- `packages/brain/src/orchestrator/remote-bridge-transport.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- `docker/cecelia-runner/entrypoint.sh`
- `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- `packages/brain/src/orchestrator/execution-contract.js`
- `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- `packages/brain/config/fleet-node-profiles.json`
- `.brain-versions`
- `DEFINITION.md`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- this plan

No Phase 5 canary, Commander/Fleet redesign, Xian credential fallback, provider-specific timeout policy, or unrelated Preview CI change is allowed.

### Task 1: Make timeout an explicit Brain-to-Worker launch field

**Files:**

- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`

- [ ] **Step 1: Write the failing transport tests**

Require every Provider launch body to contain:

```js
expect(requestBody.timeout_seconds).toBe(3600);
```

Add a table for `codex`, `claude`, and `grok` proving missing, fractional, zero, negative, or unsafe integer timeout values fail with `remote_bridge_invalid_attempt_timeout` before `fetchFn` or credential issuance.

- [ ] **Step 2: Run the Red test**

```bash
cd packages/brain
npx vitest run src/orchestrator/remote-bridge-transport.test.js
```

Expected: the request-body assertion fails because no top-level `timeout_seconds` is sent, and non-Codex invalid values currently reach the Worker.

- [ ] **Step 3: Commit Red**

```bash
git add packages/brain/src/orchestrator/remote-bridge-transport.test.js
git commit -m "test(fleet): require authoritative attempt timeout transport"
```

- [ ] **Step 4: Implement the minimal transport change**

Validate once for every Provider:

```js
const timeoutSeconds = bundle?.constraints?.timeout_seconds;
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) {
  throw new Error('remote_bridge_invalid_attempt_timeout');
}
```

Reuse the same value for the Codex envelope deadline and add `timeout_seconds: timeoutSeconds` to the Worker request body.

- [ ] **Step 5: Run Green and commit**

```bash
cd packages/brain
npx vitest run src/orchestrator/remote-bridge-transport.test.js
git add packages/brain/src/orchestrator/remote-bridge-transport.js
git commit -m "fix(fleet): carry TaskBundle timeout to Worker"
```

### Task 2: Validate timeout at Worker admission and pass it to Runner

**Files:**

- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`

- [ ] **Step 1: Write the failing Worker tests**

Add `timeout_seconds: 300` to the valid request fixture. Require invalid values to fail before `credential.consume`, `workspace.prepare`, or `docker.launch`. Require `docker.launch()` to receive `timeoutSeconds: 300`, and require the Docker create arguments to include exactly:

```js
['--env', 'HARNESS_TIMEOUT_SECONDS=300']
```

Also assert no timeout value appears in labels, mounts, callback URLs, or credential metadata.

- [ ] **Step 2: Run Red and commit**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs
git add packages/brain/scripts/fleet-worker/attempt-runner.test.cjs
git commit -m "test(fleet): require Worker timeout enforcement input"
```

Expected: request validation accepts missing/invalid timeout and Docker lacks the environment value.

- [ ] **Step 3: Implement the minimal Worker change**

In `validateLaunchRequest()`, require a positive safe integer. Pass it through `createAttemptRunner()` as `timeoutSeconds`, and include only the decimal string in the existing `envArgs()` call:

```js
HARNESS_TIMEOUT_SECONDS: String(input.timeoutSeconds),
```

- [ ] **Step 4: Run Green and commit**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs
git add packages/brain/scripts/fleet-worker/attempt-runner.cjs
git commit -m "fix(fleet): bind Worker timeout into Runner"
```

### Task 3: Enforce the same timeout and terminal result for all Providers

**Files:**

- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Modify: `docker/cecelia-runner/entrypoint.sh`

- [ ] **Step 1: Write the failing Runner contract tests**

Add a marked, extractable `attempt-timeout-contract` section expectation. Its behavioral tests must prove:

```bash
read_attempt_timeout_seconds 300   # prints 300
read_attempt_timeout_seconds 0     # fails
read_attempt_timeout_seconds 1.5   # fails
run_with_attempt_timeout 1 bash -c 'sleep 3'  # exits 124 in under 3 seconds
```

Require the Codex, Claude, and Grok branches all invoke `run_with_attempt_timeout`. Require normalized exit 124 JSON to have:

```json
{
  "status": "failed",
  "summary": "provider process timed out",
  "error": {
    "code": "provider_timeout",
    "message": "provider exceeded the TaskBundle timeout",
    "exit_code": 124
  }
}
```

The message must not include provider stdout, credentials, callback token, or filesystem paths.

- [ ] **Step 2: Run Red and commit**

```bash
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
git add docker/cecelia-runner/entrypoint-provider-contract.test.sh
git commit -m "test(runner): require provider-neutral timeout terminal"
```

- [ ] **Step 3: Implement the minimal Runner change**

Add pure helpers inside the marked section:

```bash
read_attempt_timeout_seconds() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "$value"
}

run_with_attempt_timeout() {
  local seconds="$1"
  shift
  timeout --signal=TERM --kill-after=10s "${seconds}s" "$@"
}
```

Fail closed before provider launch if `HARNESS_TIMEOUT_SECONDS` is invalid. Prefix all three provider commands with the helper, preserve `PIPESTATUS[0]`, stop the heartbeat after exit, record Codex credential-copy mutation, and write the static timeout result for exit 124. Keep the existing generic `provider_exit` normalization for every other nonzero exit.

- [ ] **Step 4: Run Green and commit**

```bash
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-codex-credential-envelope.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-callback-retry.test.sh
git add docker/cecelia-runner/entrypoint.sh
git commit -m "fix(runner): enforce provider-neutral attempt timeout"
```

### Task 4: Preserve canonical classification and pin the rebuilt Runner

**Files:**

- Modify: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`

- [ ] **Step 1: Write the failing classification test**

Require `{status:'failed', error:{code:'provider_timeout'}}` to normalize as:

```js
expect(result.failure_class).toBe('infrastructure_blocked');
```

- [ ] **Step 2: Run Red and commit**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/execution-contract.test.js
git add packages/brain/src/orchestrator/__tests__/execution-contract.test.js
git commit -m "test(kernel): classify provider timeout canonically"
```

- [ ] **Step 3: Add `provider_timeout` to the structured infrastructure code set**

Do not inspect free-form messages. Run the focused test and commit:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/execution-contract.test.js
git add packages/brain/src/orchestrator/execution-contract.js
git commit -m "fix(kernel): classify provider timeout as infrastructure"
```

- [ ] **Step 4: Build and pin the exact Runner image**

```bash
bash docker/build.sh
docker image inspect cecelia-runner:latest --format '{{.Id}}'
```

Replace all three `runner_image_digest` values with the exact `sha256:` image ID. Do not invent or normalize a registry tag.

- [ ] **Step 5: Bump Brain once and document rollback**

Bump `1.267.126` to `1.267.127` in the authoritative version files. Update both `DEFINITION.md` files with the timeout contract, static timeout failure, new Runner digest, and rollback instructions.

- [ ] **Step 6: Verify and commit**

```bash
git diff --check
cd packages/brain
npx vitest run \
  src/orchestrator/remote-bridge-transport.test.js \
  scripts/fleet-worker/attempt-runner.test.cjs \
  src/orchestrator/__tests__/execution-contract.test.js
bash ../../docker/cecelia-runner/entrypoint-provider-contract.test.sh
git add packages/brain/config/fleet-node-profiles.json .brain-versions DEFINITION.md packages/brain/DEFINITION.md packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): release Phase 4D timeout equivalence"
```

### Task 5: Review, merge, deploy, and prove the real terminal

- [ ] Run all relevant Runner shell tests and the full Fleet smoke suite.
- [ ] Run DevGate, `git diff --check`, secret scan, version/definition checks, and inspect the complete PR diff.
- [ ] Push the branch, open one Phase 4D PR, enable squash auto-merge, and fix all required CI failures.
- [ ] After merge, transfer the exact pinned Runner image US → Xian NAS → both Xian machines, load it into OrbStack, and verify all three image IDs match the committed digest.
- [ ] Deploy the merged Worker bundle and Brain `1.267.127`; verify production SHA/version and all three Worker health reports.
- [ ] Repeat the same real read-only team4 task on xian-mac-m4 with a short bounded timeout. Acceptance requires:
  - launch receipt actual machine `xian-mac-m4`;
  - attestation `verified`;
  - heartbeat during execution;
  - a terminal callback with `error.code=provider_timeout` if the Provider still hangs;
  - Worker inspect becomes `missing` without controller `cancel`;
  - no container/state/runtime/worktree residue;
  - no Xian long-term Codex credential;
  - callback credential leak count zero.
- [ ] Stop at the Phase 4D timeout/terminal boundary. Do not run or claim Phase 5.
