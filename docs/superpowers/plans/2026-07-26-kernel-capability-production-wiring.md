# Kernel Capability Production Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #4342's capability gate execute in the production Kernel dispatcher and make its selected target control the real attempt and launcher.

**Architecture:** A small production adapter consumes Brain-owned Fleet and LLM-capacity snapshots plus direct GitHub/PostgreSQL probes. `buildRealDeps()` composes that adapter into the gate; the dispatcher derives non-disableable role requirements and uses the gate's selected target for persistence and launch. Remote-machine transport remains explicitly out of scope.

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL pool, native `fetch`, Docker Compose, GitHub CLI.

---

### Task 1: Freeze the production composition contract

**Files:**
- Create: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/run.test.js`

- [ ] **Step 1: Write a failing composition test**

Add a test that calls `buildRealDeps()` without `dispatch` or `preflightGate`.
Inject only the PostgreSQL pool, Brain/GitHub fetch edge, deterministic UUID,
launcher, skill loader, and a real provider registry. Dispatch a generator task
with structured requirements and assert the order is preflight, PostgreSQL
probe, attempt persistence, adapter start, launcher.

- [ ] **Step 2: Verify the test is Red**

Run:

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-wiring.test.js
```

Expected: FAIL because `buildRealDeps()` does not construct a production gate.

- [ ] **Step 3: Commit the Red test only**

```bash
git add packages/brain/src/orchestrator/preflight/production-wiring.test.js packages/brain/src/orchestrator/__tests__/run.test.js
git commit -m "test(kernel): expose missing production capability wiring (Red)"
```

### Task 2: Add server-owned requirements derivation

**Files:**
- Create: `packages/brain/src/orchestrator/preflight/requirements.js`
- Create: `packages/brain/src/orchestrator/preflight/requirements.test.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`

- [ ] **Step 1: Write failing pure tests**

Cover planner/generator/evaluator role baselines, explicit PostgreSQL elevation,
model capability de-duplication, and an attempted `false` downgrade.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/requirements.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure derivation**

The baseline is:

```js
{
  provider_auth: true,
  github: role === 'generator' || role === 'evaluator',
  postgres: false,
  model_capabilities: ['structured_output'],
}
```

OR-merge boolean contract requirements and union model capabilities.

- [ ] **Step 4: Verify Green and commit**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/requirements.test.js
git add packages/brain/src/orchestrator/preflight/requirements.js packages/brain/src/orchestrator/preflight/requirements.test.js packages/brain/src/orchestrator/dispatcher.js
git commit -m "feat(kernel): derive server-owned capability requirements"
```

### Task 3: Implement bounded production probes

**Files:**
- Create: `packages/brain/src/orchestrator/preflight/production-probes.js`
- Create: `packages/brain/src/orchestrator/preflight/production-probes.test.js`
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js`

- [ ] **Step 1: Write failing probe tests**

Test canonical Fleet identity, machine health/capacity, deterministic provider
account ordering, GitHub HTTP verification without token leakage, real pool
`SELECT 1`, static model capability checks, malformed endpoint responses, and
redaction of `access_token`/`refresh_token`.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-probes.test.js
```

Expected: FAIL because the production adapter does not exist and suffix-token
redaction is incomplete.

- [ ] **Step 3: Implement the adapter and redaction**

Use native `fetch` with `AbortSignal.timeout`, a one-second snapshot cache, the
existing `resolveCanonicalMachineId`, `resolveGitHubToken`, pool, and registry.
Never return a credential value.

- [ ] **Step 4: Verify Green and commit**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-probes.test.js
git add packages/brain/src/orchestrator/preflight/production-probes.js packages/brain/src/orchestrator/preflight/production-probes.test.js packages/brain/src/orchestrator/preflight/capability-gate.js
git commit -m "feat(kernel): add bounded production capability probes"
```

### Task 4: Compose the gate and route the selected target

**Files:**
- Modify: `packages/brain/src/orchestrator/run.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

- [ ] **Step 1: Add failing fallback and blocked-result assertions**

Make team4 unavailable and team1 available. Assert persisted `accountId`,
selected account home, adapter start, and launcher all use team1. Assert a
required PostgreSQL failure returns `BLOCKED`, contains structured evidence, and
creates no attempt.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-wiring.test.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js
```

Expected: FAIL because production composition is absent, fallback is evidence
only, and rejection is reported as `DONE_WITH_CONCERNS`.

- [ ] **Step 3: Implement minimal production composition**

Create production probes and a capability gate in `buildRealDeps()`. Pass
`machineId`, gate, and selected target through dispatcher. Re-resolve adapter
and account home after preflight. Return `BLOCKED` for preflight rejection.

- [ ] **Step 4: Verify Green and commit**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-wiring.test.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js
git add packages/brain/src/orchestrator/run.js packages/brain/src/orchestrator/dispatcher.js packages/brain/src/orchestrator/preflight/production-wiring.test.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js
git commit -m "fix(kernel): wire capability gate into production dispatch"
```

### Task 5: Declare the production controller and credential homes

**Files:**
- Modify: `docker-compose.yml`
- Create: `packages/brain/src/orchestrator/preflight/production-compose.test.js`

- [ ] **Step 1: Write a failing compose contract test**

Parse the production compose text and require
`CECELIA_MACHINE_ID=us-mac-m4`, read-only mounts for Codex team1-team5, and a
read-only Grok home mount.

- [ ] **Step 2: Verify Red**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-compose.test.js
```

Expected: FAIL because only Codex team1 is mounted and the canonical identity is
missing.

- [ ] **Step 3: Add the minimal compose declarations**

Add four missing Codex mounts, the Grok mount, and
`CECELIA_MACHINE_ID=${CECELIA_MACHINE_ID:-us-mac-m4}`. Do not expose secrets in
the compose file.

- [ ] **Step 4: Verify Green and commit**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/production-compose.test.js
git add docker-compose.yml packages/brain/src/orchestrator/preflight/production-compose.test.js
git commit -m "fix(kernel): declare controller capability inputs"
```

### Task 6: Version, regression, and handoff

**Files:**
- Modify: `VERSION`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/src/version.js`
- Modify: `.brain-versions`
- Modify: the repository's remaining version ledger file selected by
  `scripts/check-version-sync.sh`

- [ ] **Step 1: Update from main and choose the next free Brain version**

Fetch main after PR #4343 is integrated, update this branch, inspect the tail of
`.brain-versions`, and choose exactly the next patch version. Do not reuse
#4343's version.

- [ ] **Step 2: Synchronize every required ledger**

Use the existing version script or apply the same value to every file checked by
`scripts/check-version-sync.sh`. Append one new `.brain-versions` line.

- [ ] **Step 3: Run focused and full verification**

```bash
npx vitest run packages/brain/src/orchestrator/preflight/*.test.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js packages/brain/src/orchestrator/__tests__/run.test.js
npm test -w packages/brain -- --run
bash scripts/check-version-sync.sh
bash scripts/devgate/check.sh
git diff --check
```

Expected: all scoped tests, version checks, DevGate, and diff check pass. Any
unrelated baseline failure must be reproduced on main and disclosed; it may not
be hidden by weakening tests.

- [ ] **Step 4: Push and require independent review**

Push the existing PR branch, wait for the GitHub check rollup, and request an
independent read-only review of the exact head SHA. Keep the PR unmerged until
that review passes.

- [ ] **Step 5: Production seam verification after merge**

Rebuild and deploy Brain, then verify:

```bash
docker inspect cecelia-node-brain --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^CECELIA_MACHINE_ID=us-mac-m4$'
curl -fsS http://localhost:5221/api/brain/dispatch/llm-capacity
curl -fsS http://localhost:5221/api/brain/capacity-budget
```

Run one mixed-provider Kernel fire drill and confirm the persisted attempt's
selected account/machine matches the capability evidence. Only then mark the
seam production done.
