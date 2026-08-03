# Kernel r11 Control-plane Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent infrastructure-blocked Kernel dispatches from consuming GAN convergence limits, give Fleet admission enough observable time to finish, and restore structured result files for read-only roles.

**Architecture:** Decision-log counters will join intent, launch effect, and identity-bound callback before counting role non-progress. Production preflight will use separate 5s Brain HTTP, 20s Fleet admission, and 25s outer budgets while carrying admission reasons into redacted evidence. Reviewer/Evaluator result files will use the existing per-Attempt runtime mount instead of making `/workspace` writable.

**Tech Stack:** Node.js ESM, Vitest, Bash, Docker/OrbStack, PostgreSQL-backed append-only decision log.

---

## File map

- `packages/brain/src/orchestrator/counters.js`: replay launched and terminal role executions.
- `packages/brain/src/orchestrator/__tests__/counters.test.js`: r11 decision-log regressions.
- `packages/brain/src/orchestrator/preflight/production-probes.js`: separate admission timeout and expose bounded reasons.
- `packages/brain/src/orchestrator/preflight/capability-gate.js`: retain node failure detail in blocked evidence.
- `packages/brain/src/orchestrator/run.js`: production outer/admission timeout assembly.
- `packages/brain/src/orchestrator/preflight/production-probes.test.js`: timeout and reason propagation tests.
- `packages/brain/src/orchestrator/preflight/production-wiring.test.js`: production budget nesting test.
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`: inject runtime result path on Fleet.
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`: Fleet environment contract test.
- `packages/brain/src/orchestrator/dispatcher.js`: inject the same path for local execution.
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`: local environment contract test.
- `docker/cecelia-runner/entrypoint.sh`: read evaluator evidence from the injected path.
- `docker/cecelia-runner/entrypoint-provider-contract.test.sh`: read-only result/evidence regressions.
- `packages/workflows/skills/harness-evaluator/SKILL.md`: write verdicts through `BRAIN_RESULT_FILE`.
- `packages/brain/package.json`, `packages/brain/package-lock.json`, `packages/brain/config/fleet-node-profiles.json`, `packages/brain/src/orchestrator/fleet-node/node-profile.js`, `packages/brain/scripts/fleet-worker/node-probe.cjs`: version alignment.
- `packages/brain/DEFINITION.md`: behavior, rollout, and rollback contract.

### Task 1: Make GAN streaks Attempt-authoritative

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/counters.test.js`
- Modify: `packages/brain/src/orchestrator/counters.js`

- [ ] **Step 1: Add failing r11 replay tests**

Add a helper that emits a real launch/callback chain:

```js
function completedRoleAttempt({ intentHop, effectHop, callbackHop, role, beforeRn = 0 }) {
  const attemptId = `00000000-0000-4000-8000-${String(intentHop).padStart(12, '0')}`;
  return [
    row(intentHop, `spawn:${role}`, { proposeBranchRn: beforeRn }),
    {
      hop: effectHop,
      action: 'effect:attempt_launched',
      observed: {},
      detail: { dispatch_hop: intentHop, dispatch_action: `spawn:${role}`, attempt_id: attemptId },
    },
    {
      hop: callbackHop,
      action: 'verdict:attempt_callback',
      observed: { attempt_id: attemptId, role, status: 'completed' },
      detail: { attempt_id: attemptId, role, hop: intentHop, status: 'completed' },
    },
  ];
}
```

Cover these exact assertions:

```js
expect(deriveCounters(r11Rows, { proposeBranchMaxRn: 2 }).noPushStreak).toBe(0);
expect(deriveCounters(twoCompletedWithoutAdvance, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(2);
expect(deriveCounters(callbackMissing, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(0);
expect(deriveCounters(blockedReviewers, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(0);
expect(deriveCounters(twoCompletedReviewersWithoutVerdict, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(2);
```

The r11 rows must include launched/completed Proposers at hops 6 and 21 plus unlaunched intents at hops 17 and 19.

- [ ] **Step 2: Run the Red tests**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/counters.test.js
```

Expected: the new r11 test reports `2` instead of `0`, and blocked Reviewer intents consume `noVerdictStreak`.

- [ ] **Step 3: Implement identity-bound role streak replay**

In `counters.js`, replace intent-flag `tailStreak` use with a helper whose contract is:

```js
const SUCCESSFUL_ROLE_STATUSES = new Set(['completed', 'completed_with_concerns']);

function completedRoleOutcomes(rows, role, currentProposalRn) {
  const action = `spawn:${role}`;
  const intents = rows.filter((candidate) => candidate.action === action);
  return intents.map((intent, index) => {
    const launch = rows.find((candidate) => {
      const detail = asJson(candidate.detail) ?? {};
      return candidate.action === LOG_ACTION.ATTEMPT_LAUNCHED
        && Number(detail.dispatch_hop) === Number(intent.hop)
        && detail.dispatch_action === action
        && typeof detail.attempt_id === 'string';
    });
    if (!launch) return null;
    const attemptId = (asJson(launch.detail) ?? {}).attempt_id;
    const callback = rows.find((candidate) => {
      const detail = asJson(candidate.detail) ?? {};
      return candidate.action === LOG_ACTION.ATTEMPT_CALLBACK
        && detail.attempt_id === attemptId
        && detail.role === role;
    });
    if (!callback || !SUCCESSFUL_ROLE_STATUSES.has((asJson(callback.detail) ?? {}).status)) {
      return null;
    }
    if (role === 'reviewer') {
      return rows.some((candidate) => (
        candidate.action === LOG_ACTION.VERDICT_REVIEWER
        && (asJson(candidate.detail) ?? {}).attempt_id === attemptId
      ));
    }
    const before = Number((asJson(intent.observed) ?? {}).proposeBranchRn);
    const laterIntent = intents[index + 1];
    const after = laterIntent == null
      ? currentProposalRn
      : Number((asJson(laterIntent.observed) ?? {}).proposeBranchRn);
    return Number.isFinite(before) && Number.isFinite(after) ? after > before : null;
  });
}

function terminalFalseStreak(outcomes) {
  let streak = 0;
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (outcomes[index] === false) streak += 1;
    else break;
  }
  return streak;
}
```

Use it in `deriveCounters`:

```js
const proposerOutcomes = completedRoleOutcomes(rows, 'proposer', proposeBranchMaxRn);
const reviewerOutcomes = completedRoleOutcomes(rows, 'reviewer', proposeBranchMaxRn);
// ...
noPushStreak: terminalFalseStreak(proposerOutcomes),
noVerdictStreak: terminalFalseStreak(reviewerOutcomes),
```

Update the module comments so intent rows remain audit records but not execution evidence.

- [ ] **Step 4: Run counters and derive regressions**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/counters.test.js src/orchestrator/__tests__/derive.test.js
```

Expected: both files pass and the `gan_no_push_streak` cap still fires for two real completed no-push Attempts.

- [ ] **Step 5: Commit the counter fix**

```bash
git add packages/brain/src/orchestrator/counters.js packages/brain/src/orchestrator/__tests__/counters.test.js
git commit -m "fix(brain): bind GAN streaks to completed attempts"
```

### Task 2: Separate and expose Fleet admission budgets

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-probes.js`
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js`
- Modify: `packages/brain/src/orchestrator/run.js`

- [ ] **Step 1: Write Red tests for the 5/20/25-second nesting**

Add a `createNodeAdmissionClientFn` seam to the production-probes test and capture its options:

```js
expect(createNodeAdmissionClientFn).toHaveBeenCalledWith(expect.objectContaining({
  requestTimeoutMs: 20_000,
}));
```

Construct the factory with `requestTimeoutMs: 5_000` and assert it does not change that value. In production wiring, capture `createCapabilityGate` options and assert:

```js
expect(gateOptions.probeTimeoutMs).toBe(25_000);
expect(probeOptions.nodeAdmissionRequestTimeoutMs).toBe(20_000);
```

Add a blocked admission with `reasons:[{code:'container_probe_timeout'}]` and assert the final capability evidence contains:

```js
expect(result.evidence.probe_detail.machine_health.admission_reasons)
  .toContain('container_probe_timeout');
```

- [ ] **Step 2: Run the Red tests**

```bash
cd packages/brain
npx vitest run src/orchestrator/preflight/production-probes.test.js src/orchestrator/preflight/production-wiring.test.js
```

Expected: admission is assembled with 5,000ms and blocked evidence omits the detailed reason.

- [ ] **Step 3: Implement separate timeout domains**

In `production-probes.js` add:

```js
const DEFAULT_NODE_ADMISSION_TIMEOUT_MS = 20_000;
const nodeAdmissionRequestTimeoutMs = Number(
  deps.nodeAdmissionRequestTimeoutMs ?? DEFAULT_NODE_ADMISSION_TIMEOUT_MS,
);
const createNodeAdmissionClientFn = deps.createNodeAdmissionClientFn ?? createNodeAdmissionClient;
const nodeAdmissionClient = deps.nodeAdmissionClient ?? createNodeAdmissionClientFn({
  env,
  fetchFn,
  now,
  requestTimeoutMs: nodeAdmissionRequestTimeoutMs,
});
```

Keep `requestTimeoutMs` at 5,000ms for Brain capacity/LLM snapshots.

In `run.js` assemble:

```js
nodeAdmissionRequestTimeoutMs: overrides.preflightNodeAdmissionTimeoutMs ?? 20_000,
// ...
probeTimeoutMs: overrides.preflightProbeTimeoutMs ?? 25_000,
```

- [ ] **Step 4: Carry node details into redacted evidence**

In `capability-gate.js`, record the last rejected node observation before continuing:

```js
lastNodeProbe = {
  machine_health: health ?? null,
  machine_capacity: capacity ?? null,
};
```

Pass `lastProviderProbe ?? lastNodeProbe` as `probeDetail` to `blockedResult`. Keep the existing `buildCapabilityEvidence` redaction and bounded reason strings from `production-probes.js`; do not include Worker response bodies.

- [ ] **Step 5: Run preflight regressions**

```bash
cd packages/brain
npx vitest run src/orchestrator/preflight/production-probes.test.js src/orchestrator/preflight/production-wiring.test.js src/orchestrator/preflight/capability-gate.test.js
```

Expected: all pass; fallback remains `node_not_base_admitted` while precise bounded reasons appear in `evidence.probe_detail`.

- [ ] **Step 6: Commit the admission fix**

```bash
git add packages/brain/src/orchestrator/preflight packages/brain/src/orchestrator/run.js
git commit -m "fix(brain): nest Fleet admission timeout budgets"
```

### Task 3: Restore structured results for read-only roles

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`

- [ ] **Step 1: Add Red environment and bridge tests**

For Fleet and local launch assembly, assert Reviewer/Evaluator receive:

```js
BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json'
```

and Proposer does not. Extend the entrypoint provider-contract test so
`WORKTREE_PATH` points to a non-writable directory while `BRAIN_RESULT_FILE`
points into the writable temporary runtime directory. Write current evaluator
evidence there and assert `merge_evaluator_evidence` bridges it; then write an
old `attempt_id` and assert it is rejected.

- [ ] **Step 2: Run the Red tests**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs src/orchestrator/__tests__/dispatcher.test.js
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
```

Expected: launch environment lacks `BRAIN_RESULT_FILE`; the evidence bridge reads the read-only workspace and misses the runtime result.

- [ ] **Step 3: Inject one runtime result contract on both transports**

Define the same role set in Fleet and local assembly:

```js
const RUNTIME_RESULT_ROLES = new Set(['reviewer', 'evaluator', 'judge', 'reporter']);
```

When the role is in the set, add:

```js
BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json',
```

Do not add a writable mount inside `/workspace`; reuse the existing per-Attempt `/tmp/cecelia-prompts` mount.

- [ ] **Step 4: Make Runner and evaluator Skill consume the injected path**

Change the evaluator bridge in `entrypoint.sh` to:

```bash
local brain_result_file="${BRAIN_RESULT_FILE:-${WORKTREE_PATH:-$PWD}/.brain-result.json}"
```

In `harness-evaluator/SKILL.md`, bump `1.35.0` to `1.35.1`, define at Step 0:

```bash
RESULT_FILE="${BRAIN_RESULT_FILE:-$WORKSPACE/.brain-result.json}"
```

and replace every executable final verdict redirection from
`"$WORKSPACE/.brain-result.json"` to `"$RESULT_FILE"`. Update the output
protocol text to name `BRAIN_RESULT_FILE` as authority when injected. Repository
reads and E2E commands continue using `WORKSPACE`.

- [ ] **Step 5: Run Runner and Skill contract regressions**

```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs src/orchestrator/__tests__/dispatcher.test.js
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-evaluator-evidence-boundary.test.sh
```

Expected: all pass; stale/foreign task or Attempt evidence remains rejected.

- [ ] **Step 6: Commit the runtime result channel**

```bash
git add packages/brain/scripts/fleet-worker/attempt-runner.cjs packages/brain/scripts/fleet-worker/attempt-runner.test.cjs packages/brain/src/orchestrator/dispatcher.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js docker/cecelia-runner/entrypoint.sh docker/cecelia-runner/entrypoint-provider-contract.test.sh packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "fix(runner): route read-only results through runtime mount"
```

### Task 4: Align production versions and operator contract

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Modify: `packages/brain/scripts/fleet-worker/node-probe.cjs`
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Bump aligned versions**

Set Brain to `1.267.196` in `package.json`, both lockfile version fields, and `DEFINITION.md`. Set Fleet Worker to `1.267.98` in all three NodeProfiles, `node-profile.js`, and `node-probe.cjs`. Keep Runner semantic label `cecelia-runner/v1`; its immutable image digest changes at build time.

- [ ] **Step 2: Add the DEFINITION entry**

At the top of `DEFINITION.md`, document:

- Attempt-authoritative Proposer/Reviewer streaks;
- 5s/20s/25s timeout nesting;
- bounded admission reason evidence;
- runtime result channel with `/workspace` still read-only;
- rollback to Brain `1.267.195`, Worker `1.267.97`, and the previous Runner digest requires draining the node first.

- [ ] **Step 3: Run version and focused suites**

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js scripts/fleet-worker/node-probe.test.cjs
cd ../..
git diff --check
```

Expected: versions align across all production sources and `git diff --check` is clean.

- [ ] **Step 4: Commit versions and docs**

```bash
git add packages/brain/package.json packages/brain/package-lock.json packages/brain/config/fleet-node-profiles.json packages/brain/src/orchestrator/fleet-node/node-profile.js packages/brain/scripts/fleet-worker/node-probe.cjs packages/brain/DEFINITION.md
git commit -m "chore(brain): release kernel convergence fix"
```

### Task 5: Verify, publish, deploy, and run the real r12

**Files:**
- Verify only; no new product files unless a test exposes a defect.

- [ ] **Step 1: Run the full local verification**

```bash
cd packages/brain
npm test
npm run lint
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash scripts/devgate/check.sh
git status --short
```

Expected: all tests/lint/DevGate pass and only intentional tracked changes remain.

- [ ] **Step 2: Review exact scope**

```bash
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: only the files listed by Tasks 1-4 plus this spec/plan; no Preview disk policy, Phase 4B-4D, or business implementation change.

- [ ] **Step 3: Push the feature branch and open the Cecelia PR**

```bash
git push -u origin fix/kernel-harness-r11-control-plane
gh pr create --repo perfectuser21/cecelia --base main --head fix/kernel-harness-r11-control-plane --title "fix(kernel): converge real Fleet harness runs" --body-file /tmp/kernel-r11-pr-body.md
```

The PR body must include r11 task/run IDs, the two successful proposal SHAs, Red/Green commands, timeout evidence, rollback versions, and the statement that tick remains off.

- [ ] **Step 4: Repair CI and squash merge only after fresh green checks**

```bash
PR_NUM="$(gh pr view --repo perfectuser21/cecelia --json number --jq .number)"
gh pr checks --repo perfectuser21/cecelia --watch "$PR_NUM"
gh pr merge --repo perfectuser21/cecelia --squash --delete-branch "$PR_NUM"
```

Expected: every required check is green on the final PR head before merge.

- [ ] **Step 5: Build and pin the new Runner, then deploy US M4**

From a clean worktree at the merged `origin/main`, run:

```bash
git fetch origin main
git switch --detach origin/main
bash packages/brain/scripts/fleet-worker/fleet-rollout.sh us-mac-m4 --apply
bash packages/brain/scripts/fleet-worker/fleet-nodectl.sh admit us-mac-m4
curl --fail --silent http://127.0.0.1:5231/health | jq '{worker_version,runner,docker,disk,checks}'
```

Expected: rollout builds once and records the resulting immutable `sha256:` digest; health reports Worker `1.267.98`, the exact new Runner digest, and all admission checks true. Verify Brain `/api/brain/health` reports `1.267.196`. Keep Xian drained until its existing NAS/OrbStack prerequisites are healthy.

- [ ] **Step 6: Launch one real Kernel r12 with tick off**

Pin the task to `perfectuser21/zenithjoy-workspace` PR #1581 head `c305f6217da65bb69413c39e621b7e797e0fb189` unless the PR head changed; if changed, record and use the new exact SHA. Require the trace:

```text
Planner -> Proposer -> Reviewer -> Generator -> Evaluator(exact final SHA) -> Judge(exact same SHA) -> Reporter
```

Do not use a synthetic canary as acceptance and do not merge PR #1581 until Evaluator and Judge both pass the same final SHA.
