# Kernel ReleaseRun Nightly Quality Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the old fresh-nightly production quality requirement as a server-owned, fail-closed, append-only ReleaseRun observation before production authority exists.

**Architecture:** A focused pure module validates the fixed 48-hour `main`/`nightly-regression.yml` policy and canonical GitHub Actions receipt. The production adapter queries that fixed GitHub endpoint through authenticated `gh`; the executor validates and persists the receipt in the unique `production_deploying` transition before rollback or production intents/effects.

**Tech Stack:** Node.js 20/22 ESM, Vitest, GitHub CLI/API, existing ReleaseRun executor and append-only PostgreSQL transition ledger.

---

## File map

- Create `packages/brain/src/orchestrator/release-run-quality.js`: fixed policy constants and pure canonical receipt validation.
- Create `packages/brain/src/orchestrator/__tests__/release-run-quality.test.js`: validator boundary tests.
- Modify `packages/brain/src/orchestrator/release-run-adapters.js`: fixed GitHub API observer.
- Modify `packages/brain/src/orchestrator/__tests__/release-run-adapters.test.js`: adapter selection, fixed query, and fail-closed tests.
- Modify `packages/brain/src/orchestrator/release-run-executor.js`: quality gate at `staging_passed`.
- Modify `packages/brain/src/orchestrator/__tests__/release-run-executor.test.js`: block-before-authority and durable receipt tests.
- Modify `packages/brain/src/orchestrator/run.js`: default and injected adapter wiring.
- Modify `packages/brain/src/orchestrator/__tests__/run.test.js`: injection proof.
- Modify `packages/brain/src/__tests__/nightly-regression-config.test.js`: durable knife-C contract.
- Modify `packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js`: no retained bypass surface.
- Delete `scripts/ci/check-nightly-green.sh`: orphan workflow-owned authority with bypass.
- Delete `scripts/ci/__tests__/check-nightly-green.test.sh`: obsolete shell contract.
- Modify `packages/brain/package.json`, `packages/brain/package-lock.json`, root `package-lock.json`, `.brain-versions`, `DEFINITION.md`, and `packages/brain/DEFINITION.md`: Brain version/release boundary metadata.

### Task 1: Pure canonical release-quality contract

**Files:**
- Create: `packages/brain/src/orchestrator/release-run-quality.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-quality.test.js`

- [ ] **Step 1: Write validator RED tests**

Define fixed evidence at `2026-07-29T12:00:00.000Z` and assert:

```js
const observation = {
  status: 'pass',
  repository: 'perfectuser21/cecelia',
  workflow_file: 'nightly-regression.yml',
  branch: 'main',
  run_id: 123456,
  head_sha: 'a'.repeat(40),
  conclusion: 'success',
  completed_at: '2026-07-28T12:00:00.000Z',
  html_url: 'https://github.com/perfectuser21/cecelia/actions/runs/123456',
};

expect(validateReleaseQualityObservation(observation, {
  repository: 'perfectuser21/cecelia',
  observedAt: '2026-07-29T12:00:00.000Z',
})).toEqual(observation);
```

Use `it.each` to reject wrong repository, workflow, branch, conclusion, unsafe
run id, non-40-character SHA, mismatched run URL, invalid completion time,
completion after observation, and completion older than 48 hours.

- [ ] **Step 2: Run RED validator test**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/release-run-quality.test.js --reporter=verbose
```

Expected: FAIL because `release-run-quality.js` does not exist.

- [ ] **Step 3: Implement the fixed pure contract**

Export:

```js
export const RELEASE_QUALITY_WORKFLOW = 'nightly-regression.yml';
export const RELEASE_QUALITY_BRANCH = 'main';
export const RELEASE_QUALITY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function validateReleaseQualityObservation(
  observation,
  { repository, observedAt },
) {
  // Reject non-exact shapes and invalid trusted expectations.
  // Parse completed_at/observedAt, require 0 <= age <= MAX_AGE.
  // Require the exact canonical repository/run URL.
  // Return Object.freeze with the nine canonical fields only.
}
```

Throw `ReleaseRunError` with `release_quality_*` codes and never include
untrusted values in messages.

- [ ] **Step 4: Run GREEN validator test**

Run the Step 2 command.

Expected: all validator cases PASS.

- [ ] **Step 5: Commit contract**

```bash
git add packages/brain/src/orchestrator/release-run-quality.js \
  packages/brain/src/orchestrator/__tests__/release-run-quality.test.js
git commit -m "feat(kernel): validate canonical nightly release quality"
```

### Task 2: Server-owned fixed GitHub observation

**Files:**
- Modify: `packages/brain/src/orchestrator/release-run-adapters.js`
- Modify: `packages/brain/src/orchestrator/__tests__/release-run-adapters.test.js`

- [ ] **Step 1: Write adapter RED tests**

Inject `githubExecFile` and call:

```js
const receipt = await createReleaseRunAdapters({
  githubExecFile,
}).observeReleaseQuality({
  repository: 'perfectuser21/cecelia',
  observed_at: '2026-07-29T12:00:00.000Z',
});
```

Assert the only CLI call is:

```js
expect(githubExecFile).toHaveBeenCalledWith([
  'api',
  'repos/perfectuser21/cecelia/actions/workflows/nightly-regression.yml/runs?branch=main&status=completed&per_page=5',
  '-H',
  'Accept: application/vnd.github+json',
]);
```

Return one fresh success and assert the canonical receipt. Add cases for stale
success, failed run, malformed response, mismatched repository URL/run id,
future timestamp, and thrown CLI error. Assert failures are exactly
`{ status: 'fail' }` or `{ status: 'unavailable' }`, with no thrown error text.

- [ ] **Step 2: Run RED adapter tests**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/release-run-adapters.test.js --reporter=verbose
```

Expected: FAIL because `observeReleaseQuality` is absent.

- [ ] **Step 3: Implement fixed query and canonical selection**

Add an injected default:

```js
githubExecFile = (args) => execFileSync('gh', args, {
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
  timeout: 60_000,
}),
```

`observeReleaseQuality` must:

1. build the endpoint only from the ReleaseRun repository plus fixed constants;
2. parse `{ total_count, workflow_runs }`;
3. require a safe `total_count`, an array with at most five rows, and
   `total_count >= workflow_runs.length`;
4. map only `status=completed` and `conclusion=success` rows to exact canonical
   fields, using `updated_at` as the old gate's completion timestamp;
5. validate each candidate with the exact request observation time;
6. return the newest valid receipt or `{ status: 'fail' }`;
7. return `{ status: 'unavailable' }` on transport/parse/incomplete data.

- [ ] **Step 4: Run GREEN adapter tests**

Run the Step 2 command.

Expected: all adapter tests PASS and no error string is returned.

- [ ] **Step 5: Commit adapter**

```bash
git add packages/brain/src/orchestrator/release-run-adapters.js \
  packages/brain/src/orchestrator/__tests__/release-run-adapters.test.js
git commit -m "feat(kernel): observe fresh nightly quality from GitHub"
```

### Task 3: Gate production authority in the ReleaseRun executor

**Files:**
- Modify: `packages/brain/src/orchestrator/release-run-executor.js`
- Modify: `packages/brain/src/orchestrator/__tests__/release-run-executor.test.js`

- [ ] **Step 1: Extend the test fixture with trusted time and fresh evidence**

Add:

```js
const OBSERVED_AT = '2026-07-29T12:00:00.000Z';
const releaseQuality = {
  status: 'pass',
  repository: 'perfectuser21/cecelia',
  workflow_file: 'nightly-regression.yml',
  branch: 'main',
  run_id: 123456,
  head_sha: 'c'.repeat(40),
  conclusion: 'success',
  completed_at: '2026-07-28T12:00:00.000Z',
  html_url: 'https://github.com/perfectuser21/cecelia/actions/runs/123456',
};
```

Default `deps()` includes `now: () => new Date(OBSERVED_AT)` and a mocked
`observeReleaseQuality` that returns this receipt.

- [ ] **Step 2: Write executor RED cases**

Add cases proving:

- a missing adapter returns `release_quality_adapter_unavailable`;
- unavailable evidence returns `release_quality_observation_unavailable`;
- stale/malformed/fail evidence returns `release_quality_not_passed`;
- every blocked case remains at `staging_passed`, never calls
  `findOrCreateRollbackIntent`, `prepareProductionRollback`,
  `findOrCreateIntent` for production, `runProduction`, or
  `observeProduction`;
- the passing path calls the quality observer with immutable repository and
  the exact server observation time;
- `production_deploying` transition evidence contains exactly
  `{ merge_sha, release_quality, artifact_rollback_intent_ids }`;
- a retry already at `production_deploying` does not call the quality observer.

- [ ] **Step 3: Run RED executor tests**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/release-run-executor.test.js --reporter=verbose
```

Expected: new cases FAIL because the executor does not call the quality
observer.

- [ ] **Step 4: Implement the gate before rollback authority**

Inject `observeReleaseQuality` and `now`. In the
`release.state === 'staging_passed'` branch:

```js
const observedAt = now().toISOString();
const observedQuality = await observeReleaseQuality({
  release_run_id: release.id,
  repository: release.repository,
  merge_sha: release.merge_sha,
  observed_at: observedAt,
});
const releaseQuality = validateReleaseQualityObservation(observedQuality, {
  repository: release.repository,
  observedAt,
});
```

Map unavailable/throw to `release_quality_observation_unavailable` and all
invalid/fail evidence to `release_quality_not_passed`. Only after a canonical
receipt exists may the executor create rollback intents and transition to
`production_deploying`. Persist the receipt as `release_quality`.

- [ ] **Step 5: Run GREEN executor tests**

Run the Step 3 command.

Expected: all executor cases PASS.

- [ ] **Step 6: Commit executor gate**

```bash
git add packages/brain/src/orchestrator/release-run-executor.js \
  packages/brain/src/orchestrator/__tests__/release-run-executor.test.js
git commit -m "fix(kernel): gate production on durable nightly quality"
```

### Task 4: Runtime wiring and legacy authority retirement

**Files:**
- Modify: `packages/brain/src/orchestrator/run.js`
- Modify: `packages/brain/src/orchestrator/__tests__/run.test.js`
- Modify: `packages/brain/src/__tests__/nightly-regression-config.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js`
- Delete: `scripts/ci/check-nightly-green.sh`
- Delete: `scripts/ci/__tests__/check-nightly-green.test.sh`

- [ ] **Step 1: Write runtime/surface RED tests**

In `run.test.js`, read `run.js` as source and assert both the public injection
parameter and the default adapter fallback are present:

```js
expect(source).toMatch(
  /buildDefaultHandlers\(\{[\s\S]*?observeReleaseQuality,[\s\S]*?\}\)/,
);
expect(source).toMatch(
  /observeReleaseQuality:\s*observeReleaseQuality\s*\?\?\s*defaultReleaseAdapters\.observeReleaseQuality/,
);
```

Behavioral injection remains covered by the `deps()` fixture passing its
`observeReleaseQuality` spy into `createReleaseRunExecutor(d)` in the executor
tests; this source assertion protects the default assembly seam.

Rewrite knife-C assertions to require:

```js
expect(QUALITY).toContain("RELEASE_QUALITY_WORKFLOW = 'nightly-regression.yml'");
expect(EXECUTOR).toContain('observeReleaseQuality');
expect(EXECUTOR).toContain('release_quality');
expect(RUN).toContain('defaultReleaseAdapters.observeReleaseQuality');
expect(WORKFLOW).not.toMatch(/nightly_gate|BYPASS_NIGHTLY_GATE/);
expect(() => read('scripts/ci/check-nightly-green.sh')).toThrow();
```

The ReleaseRun surface test scans production workflows and repository scripts
for `BYPASS_NIGHTLY_GATE`.

- [ ] **Step 2: Run RED runtime/surface tests**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/run.test.js \
  src/__tests__/nightly-regression-config.test.js \
  src/orchestrator/__tests__/release-run-surfaces.test.js \
  --reporter=verbose
```

Expected: FAIL because default wiring is absent and the bypass shell still
exists.

- [ ] **Step 3: Wire the adapter and delete the orphan authority**

Add `observeReleaseQuality` to `buildDefaultHandlers()` parameters and pass:

```js
observeReleaseQuality: observeReleaseQuality
  ?? defaultReleaseAdapters.observeReleaseQuality,
```

Delete the orphan shell and its tests. Keep nightly A/B schedule/YAML parsing
tests intact while replacing only the knife-C workflow-text assertion.

- [ ] **Step 4: Run GREEN runtime/surface tests**

Run the Step 2 command.

Expected: all targeted cases PASS.

- [ ] **Step 5: Commit wiring and retirement**

```bash
git add packages/brain/src/orchestrator/run.js \
  packages/brain/src/orchestrator/__tests__/run.test.js \
  packages/brain/src/__tests__/nightly-regression-config.test.js \
  packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js \
  scripts/ci/check-nightly-green.sh \
  scripts/ci/__tests__/check-nightly-green.test.sh
git commit -m "fix(kernel): retire workflow-owned nightly release gate"
```

### Task 5: Version boundary, focused regression, and DevGate

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Bump the exact branch version**

Advance the exact-base Brain package version from `1.268.20` to `1.268.21` in
both manifests and root lock metadata. Append `1.268.21` to
`.brain-versions`. Add matching top sections in both definition files stating:

- fresh `main` nightly success no older than 48 hours is required;
- canonical receipt is append-only in `production_deploying`;
- failure blocks before rollback/production authority;
- no bypass exists;
- rollback target is `1.268.20`.

- [ ] **Step 2: Verify version synchronization**

```bash
bash scripts/check-version-sync.sh
```

Expected: exit 0 with Brain `1.268.21` synchronized.

- [ ] **Step 3: Run the complete focused ReleaseRun/CI suite**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/release-run-quality.test.js \
  src/orchestrator/__tests__/release-run-adapters.test.js \
  src/orchestrator/__tests__/release-run-executor.test.js \
  src/orchestrator/__tests__/release-run-contract.test.js \
  src/orchestrator/__tests__/release-run-store.test.js \
  src/orchestrator/__tests__/release-run-surfaces.test.js \
  src/orchestrator/__tests__/run.test.js \
  src/__tests__/nightly-regression-config.test.js \
  --reporter=verbose
```

Expected: all selected files and tests PASS with zero failures.

- [ ] **Step 4: Run ReleaseRun shell and CI contracts**

```bash
bash packages/engine/tests/integration/release-deploy-stage.test.sh
bash tests/regression/gate3-sha-truth/sha-account.test.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
node scripts/devgate/scan-rci-coverage.cjs
bash scripts/devgate/require-rci-update-if-p0p1.sh
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit version boundary**

```bash
git add packages/brain/package.json packages/brain/package-lock.json \
  package-lock.json .brain-versions DEFINITION.md packages/brain/DEFINITION.md
git commit -m "docs(brain): release durable nightly quality gate"
```

- [ ] **Step 6: Fresh final verification and exact handoff**

Repeat Steps 2–4 from the final `HEAD`, then record:

```bash
git status --short
git rev-parse HEAD
git show --stat --oneline HEAD
```

Expected: clean worktree, exact commit SHA, no push/PR/merge/deploy.
