# Harness Transitional Test Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Test Contract double-path bug and the CI-before-graduation deadlock without allowing unregistered sprint tests.

**Architecture:** A shared CommonJS module owns Test Contract parsing, canonical E2E extraction, and safe path resolution so the CommonJS coverage checker, ESM evaluator, and ESM pyramid guard cannot drift. The pyramid guard retains raw artifact reporting but applies the zero orphan baseline only to artifacts registered by the same sprint contract; the ratchet imports that exact classification. Canonical contract fallback is allowed only when `contract-draft.md` is absent (`ENOENT`), never after other read errors.

**Tech Stack:** Node.js 22, CommonJS/ESM interop, Vitest, GitHub Actions shell gates.

---

## File Structure

- Create `scripts/lib/test-contract-paths.cjs`: pure contract parser, repository-root inference, safe declared/graduated path resolution, and same-sprint registration discovery.
- Modify `packages/engine/scripts/devgate/check-test-coverage.cjs`: consume the shared parser/resolver instead of unconditionally joining `sprintDir`.
- Create `packages/engine/tests/devgate/check-test-coverage-paths.test.ts`: permanent regression coverage for repository-relative, legacy relative, graduated, and traversal cases.
- Modify `scripts/test-pyramid-guard.mjs`: classify raw artifacts into registered transitional and unregistered orphan sets; enforce A1 only on the latter.
- Modify `tests/test-pyramid-guard.test.ts`: behavior tests for registered, unregistered, cross-sprint, and missing contract references.
- Modify `scripts/ratchet-guard.mjs`: measure `orphans` with the same classifier and accept a test-only/general-purpose `--root` CLI override.
- Create `tests/ratchet-transitional-orphans.test.ts`: true CLI regression proving ratchet and pyramid agree.

### Task 1: Safe Test Contract path resolution

**Files:**
- Create: `scripts/lib/test-contract-paths.cjs`
- Modify: `packages/engine/scripts/devgate/check-test-coverage.cjs`
- Test: `packages/engine/tests/devgate/check-test-coverage-paths.test.ts`

- [ ] **Step 1: Write failing path regression tests**

Create a temporary repository shape containing `sprints/demo/contract-draft.md`. Drive the real coverage checker and assert:

```ts
it('resolves a repository-relative sprints path exactly once', () => {
  expect(runGate('sprints/demo/tests/path.test.ts')).toMatchObject({ code: 0 });
});

it('keeps legacy tests/path.test.ts relative to the contract sprint', () => {
  expect(runGate('tests/path.test.ts')).toMatchObject({ code: 0 });
});

it('resolves a frozen sprint path to its deterministic graduated destination', () => {
  expect(runGraduatedGate('sprints/demo/tests/path.test.ts')).toMatchObject({ code: 0 });
});

it('rejects paths escaping the repository root', () => {
  expect(runGate('../../outside.test.ts').code).not.toBe(0);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run packages/engine/tests/devgate/check-test-coverage-paths.test.ts
```

Expected: repository-relative and graduated cases fail because the existing checker duplicates the sprint path or cannot find the moved file.

- [ ] **Step 3: Implement the shared resolver**

Implement and export:

```js
parseTestContract(content)
inferRepositoryRoot(contractPath, explicitRoot)
resolveContractTestFile({ root, contractPath, testFile, existsSync })
listRegisteredSprintArtifacts(root)
```

Resolution must reject absolute/escaping paths, treat `sprints/`, `packages/`, `scripts/`, and `tests/regression/` as repository-relative, preserve sprint-relative `tests/...`, and search deterministic graduation targets only after the declared source is absent.

- [ ] **Step 4: Wire the real checker to the resolver**

Replace `path.join(sprintDir, row.testFile)` with the shared resolver. Read behavior names from the resolved source or permanent target. Keep failure output showing both the declared path and attempted candidates.

- [ ] **Step 5: Verify GREEN and existing checker compatibility**

Run:

```bash
npx vitest run \
  packages/engine/tests/devgate/check-test-coverage-paths.test.ts \
  packages/engine/tests/devgate/check-test-coverage-ext.test.ts \
  packages/engine/tests/skills/harness-v5-ci-checks.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/lib/test-contract-paths.cjs \
  packages/engine/scripts/devgate/check-test-coverage.cjs \
  packages/engine/tests/devgate/check-test-coverage-paths.test.ts
git commit -m "fix(harness): normalize frozen Test Contract paths"
```

### Task 2: Registered transitional sprint tests

**Files:**
- Modify: `scripts/test-pyramid-guard.mjs`
- Modify: `tests/test-pyramid-guard.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Add isolated fixtures and assert:

```ts
expect(classifySprintArtifacts(root)).toMatchObject({
  registered: { total: 2 },
  unregistered: { total: 1 },
  raw: { total: 3 },
});
```

Cover a same-sprint contract registering one test and `e2e-verify.sh`, an unregistered test, a cross-sprint reference, and a nonexistent reference.

Also cover the Harness-native E2E form used by live contracts: a canonical
`## E2E 验收` fenced `bash` block registers the same sprint's
`e2e-verify.sh` only when normalized contents match. Missing, duplicate, or
drifted E2E blocks remain unregistered. Drive the real evaluator export through
the same shared parser, reject ambiguous evaluator-recognized E2E headings, and
prove a non-`ENOENT` canonical read failure cannot fall back to a stale secondary
contract.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/test-pyramid-guard.test.ts
```

Expected: fail because `classifySprintArtifacts` does not exist and A1 still uses the raw count.

- [ ] **Step 3: Implement classification and A1 semantics**

Add `classifySprintArtifacts(root)` using `listRegisteredSprintArtifacts(root)`. Preserve `countOrphans(root)` as the raw compatibility API. Change A1 to compare `classification.unregistered.total` with the existing zero baseline and return all three counts in the result:

```js
{
  orphans: classification.raw,
  registered_transitional: classification.registered,
  unregistered_orphans: classification.unregistered,
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run tests/test-pyramid-guard.test.ts
bash scripts/__tests__/test-pyramid-guard.test.sh
```

Expected: all tests pass; unregistered fixtures still fire A1.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/test-pyramid-guard.mjs tests/test-pyramid-guard.test.ts
git commit -m "fix(harness): distinguish registered sprint tests"
```

### Task 3: Unify ratchet orphan measurement

**Files:**
- Modify: `scripts/ratchet-guard.mjs`
- Create: `tests/ratchet-transitional-orphans.test.ts`

- [ ] **Step 1: Write the failing real-CLI ratchet test**

Create a temporary root with a zero-watermark registry and one contract-registered sprint test. Assert the real CLI passes. Remove the contract and assert the same test becomes an orphan and the CLI fails with `orphans`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/ratchet-transitional-orphans.test.ts
```

Expected: fail because ratchet has no `--root` support and still measures `countOrphans().total`.

- [ ] **Step 3: Implement one measurement source**

Import `classifySprintArtifacts`, parse `--root`, and measure:

```js
const classification = classifySprintArtifacts(root);
return {
  value: classification.unregistered.total,
  detail: `raw=${classification.raw.total} registered=${classification.registered.total} unregistered=${classification.unregistered.total}`,
};
```

Do not change registry watermarks.

- [ ] **Step 4: Verify GREEN and proven-to-fire behavior**

Run:

```bash
npx vitest run tests/ratchet-transitional-orphans.test.ts
bash scripts/__tests__/ratchet-guard.test.sh
```

Expected: registered fixture passes, missing-contract fixture fails, existing guard self-test remains green.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/ratchet-guard.mjs tests/ratchet-transitional-orphans.test.ts
git commit -m "fix(harness): unify transitional orphan ratchet"
```

### Task 4: Integrated verification and handoff

**Files:**
- Create: `docs/handoffs/20260726-harness-gate-bootstrap.md`
- No Brain source file changes are permitted, so no Brain version bump or smoke allowlist edit is part of this bootstrap.

- [ ] **Step 1: Reproduce the #4342 contract against the bootstrap checker**

Create a disposable integration worktree that combines PR #4342 with the bootstrap commits:

```bash
git fetch origin pull/4342/head:refs/remotes/origin/pr-4342
VERIFY_DIR="$(mktemp -d /tmp/cecelia-bootstrap-verify.XXXXXX)"
git worktree add --detach "$VERIFY_DIR" refs/remotes/origin/pr-4342
git -C "$VERIFY_DIR" merge --no-commit hotfix/harness-gate-bootstrap
node "$VERIFY_DIR/packages/engine/scripts/devgate/check-test-coverage.cjs" \
  "$VERIFY_DIR/sprints/07251915-kernel-ed561be4/contract-draft.md"
git -C "$VERIFY_DIR" merge --abort
git worktree remove "$VERIFY_DIR"
```

Expected: no duplicated `sprints/.../sprints/...` path.

- [ ] **Step 2: Run focused regression**

```bash
npx vitest run \
  packages/engine/tests/devgate/check-test-coverage-paths.test.ts \
  packages/engine/tests/devgate/check-test-coverage-ext.test.ts \
  packages/engine/tests/skills/harness-v5-ci-checks.test.ts \
  tests/test-pyramid-guard.test.ts \
  tests/ratchet-transitional-orphans.test.ts
bash scripts/__tests__/test-pyramid-guard.test.sh
bash scripts/__tests__/ratchet-guard.test.sh
```

Expected: all pass.

- [ ] **Step 3: Run DevGate-relevant checks**

```bash
node packages/engine/scripts/devgate/check-test-coverage.cjs
CI=true node scripts/test-pyramid-guard.mjs
node scripts/ratchet-guard.mjs
git diff --check origin/main...HEAD
```

Expected: all pass; no baseline increase.

- [ ] **Step 4: Independent read-only review**

Reviewer checks that unregistered, cross-sprint, nonexistent, absolute, and traversal cases remain fail-closed and that #4342/#4343 business files are absent from the bootstrap diff.

- [ ] **Step 5: Push and open an unmerged PR**

Write `docs/handoffs/20260726-harness-gate-bootstrap.md` with root-cause evidence,
Red/Green SHAs, exact verification commands, and explicit confirmation that no
Brain business code, baseline, approval, merge, or deployment was changed.

```bash
git add docs/handoffs/20260726-harness-gate-bootstrap.md
git commit -m "docs(harness): hand off gate bootstrap evidence"
git push -u origin hotfix/harness-gate-bootstrap
gh pr create --base main --head hotfix/harness-gate-bootstrap \
  --title "fix(harness): unblock registered sprint test graduation" \
  --body-file docs/handoffs/20260726-harness-gate-bootstrap.md
```

Keep the PR open for independent approval. Do not deploy the bootstrap branch directly.
