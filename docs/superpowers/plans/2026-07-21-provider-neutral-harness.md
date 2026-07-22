# Provider-Neutral Harness Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Complete the existing Harness reconcile Kernel with versioned contracts, frozen Skills, persistent attempts, Claude/Codex adapters, adversarial role isolation, and internal callbacks.

**Architecture:** Reuse packages/brain/src/orchestrator as the only state machine. A dispatcher creates one persistent attempt per Kernel hop, resolves a Provider Adapter, and launches the existing runner with a frozen TaskBundle. Brain/PostgreSQL remain the internal coordination plane; no public protocol service is added.

**Tech Stack:** Node.js ESM, Zod, PostgreSQL, Vitest, Bash, Claude Code CLI, Codex CLI, existing Cecelia Docker runner.

---

## File map

- Create packages/brain/migrations/357_harness_provider_attempts.sql for attempt, lease, session, bundle, and result state.
- Create packages/brain/src/orchestrator/execution-contract.js for TaskBundle/HarnessResult schemas.
- Create packages/brain/src/orchestrator/skill-bundle.js for repo-owned Skill freezing.
- Create packages/brain/src/orchestrator/provider-registry.js and providers/{claude,codex}.js.
- Create packages/brain/src/orchestrator/attempt-store.js and dispatcher.js.
- Modify packages/brain/src/orchestrator/run.js to replace the T3 NotImplemented dispatcher.
- Modify packages/brain/src/routes/harness-callback.js and docker/cecelia-runner/entrypoint.sh for attempt callbacks.
- Modify packages/brain/src/harness-skill-relay.js and harness-relay-watchdog.js for opt-in Kernel rollout.
- Add matching Vitest and Bash contract tests.
- Update Brain DEFINITION/version/feature files required by DevGate.

### Task 1: Add the attempt schema

**Files:**
- Create: packages/brain/migrations/357_harness_provider_attempts.sql
- Create: packages/brain/src/__tests__/migration-357-harness-attempts.test.js

- [ ] **Step 1: Write the failing migration contract test**

    import { describe, it, expect } from 'vitest';
    import { readFileSync } from 'node:fs';

    const sql = readFileSync(
      new URL('../../migrations/357_harness_provider_attempts.sql', import.meta.url),
      'utf8'
    );

    describe('migration 357 harness_attempts', () => {
      it('stores provider-neutral attempt state', () => {
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS harness_attempts/);
        expect(sql).toMatch(/UNIQUE\s*\(run_id,\s*hop\)/);
        expect(sql).toMatch(/provider_session_id TEXT/);
        expect(sql).toMatch(/task_bundle JSONB NOT NULL/);
        expect(sql).toMatch(/result JSONB/);
        expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ/);
      });
    });

- [ ] **Step 2: Verify RED**

Run from packages/brain:

    npx vitest run src/__tests__/migration-357-harness-attempts.test.js

Expected: FAIL because migration 357 is absent.

- [ ] **Step 3: Implement the additive migration**

Create the columns listed in the design, role/provider/status CHECK constraints, UNIQUE(run_id, hop), active-lease indexes, and schema_version insert. Do not alter legacy run rows.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/__tests__/migration-357-harness-attempts.test.js
    git add packages/brain/migrations/357_harness_provider_attempts.sql packages/brain/src/__tests__/migration-357-harness-attempts.test.js
    git commit -m "feat(harness): add provider-neutral attempt schema"

### Task 2: Define and validate the execution contract

**Files:**
- Create: packages/brain/src/orchestrator/execution-contract.js
- Create: packages/brain/src/orchestrator/__tests__/execution-contract.test.js

- [ ] **Step 1: Write failing tests**

    import { parseTaskBundle, parseHarnessResult, toKernelStatus } from '../execution-contract.js';

    it('rejects provider-native instructions', () => {
      expect(() => parseTaskBundle(validBundle({ objective: '调用 Skill(foo)' })))
        .toThrow(/provider_native_instruction/);
    });

    it('maps concerns to the existing Kernel status', () => {
      expect(toKernelStatus('completed_with_concerns')).toBe('DONE_WITH_CONCERNS');
    });

    it('requires decisions for reviewer/evaluator/judge', () => {
      expect(() => parseHarnessResult({ ...validResult(), decision: null }, 'reviewer'))
        .toThrow(/decision/);
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/orchestrator/__tests__/execution-contract.test.js

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement minimal Zod schemas**

Export TASK_CONTRACT_VERSION, RESULT_CONTRACT_VERSION, ROLE_VALUES, parseTaskBundle, parseHarnessResult, and toKernelStatus. Reject Task tool, Skill(...), and spawn_agent in provider-neutral business fields. Require structured verdict decisions for adversarial roles.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/orchestrator/__tests__/execution-contract.test.js
    git add packages/brain/src/orchestrator/execution-contract.js packages/brain/src/orchestrator/__tests__/execution-contract.test.js
    git commit -m "feat(harness): define provider-neutral execution contract"

### Task 3: Freeze repository-owned Skill bundles

**Files:**
- Create: packages/brain/src/orchestrator/skill-bundle.js
- Create: packages/brain/src/orchestrator/__tests__/skill-bundle.test.js
- Modify: packages/brain/src/harness-shared.js

- [ ] **Step 1: Write failing repo-first and digest tests**

    it('loads the repository Skill before provider home directories', () => {
      const bundle = loadSkillBundle('harness-planner', { repoRoot: fixtureRoot });
      expect(bundle.content).toContain('REPO_MARKER');
    });

    it('returns stable version and sha256 digest', () => {
      const a = loadSkillBundle('harness-planner', { repoRoot: fixtureRoot });
      const b = loadSkillBundle('harness-planner', { repoRoot: fixtureRoot });
      expect(a).toEqual(b);
      expect(a.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/orchestrator/__tests__/skill-bundle.test.js

- [ ] **Step 3: Implement repo-first resolution**

Parse frontmatter version, hash exact UTF-8 content, and support only explicit CECELIA_SKILLS_ROOT override. Make legacy loadSkillContent delegate to loadSkillBundle while keeping its string API.

- [ ] **Step 4: Verify compatibility and commit**

    npx vitest run src/orchestrator/__tests__/skill-bundle.test.js src/__tests__/harness-shared.test.js src/__tests__/harness-shared-b39.test.js
    git add packages/brain/src/orchestrator/skill-bundle.js packages/brain/src/orchestrator/__tests__/skill-bundle.test.js packages/brain/src/harness-shared.js
    git commit -m "feat(harness): freeze repo-owned skill bundles"

### Task 4: Add Provider Registry and Claude/Codex adapters

**Files:**
- Create: packages/brain/src/orchestrator/provider-registry.js
- Create: packages/brain/src/orchestrator/providers/claude.js
- Create: packages/brain/src/orchestrator/providers/codex.js
- Create: packages/brain/src/orchestrator/__tests__/provider-registry.test.js
- Create: packages/brain/src/orchestrator/__tests__/provider-adapters.test.js

- [ ] **Step 1: Write failing capability and command tests**

    it('auto resolves by required capabilities', () => {
      const registry = createProviderRegistry([claudeAdapter, codexAdapter]);
      expect(registry.resolve({ provider: 'auto', requires: ['structured_output'] }).name)
        .toBeTruthy();
    });

    it('Codex fresh start uses JSONL/schema without choosing a model', () => {
      const spec = codexAdapter.start({ bundle, execution: { codexHome: '/tmp/codex' } });
      expect(spec.args).toContain('--json');
      expect(spec.args).toContain('--output-schema');
      expect(spec.args).not.toContain('--model');
    });

    it('Codex resume stays inside one attempt thread', () => {
      const spec = codexAdapter.resume({
        attempt: { provider_session_id: 'thread-1' },
        input: 'continue'
      });
      expect(spec.args).toEqual(expect.arrayContaining(['exec', 'resume', 'thread-1']));
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/orchestrator/__tests__/provider-registry.test.js src/orchestrator/__tests__/provider-adapters.test.js

- [ ] **Step 3: Implement pure adapter descriptors**

Adapters return command/env/output descriptors and never execute processes. Claude uses -p with JSON output. Codex uses exec --json --output-schema --output-last-message, parses thread.started, and uses exec resume only in resume(). Neither adapter supplies a model when configuration says auto.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/orchestrator/__tests__/provider-registry.test.js src/orchestrator/__tests__/provider-adapters.test.js
    git add packages/brain/src/orchestrator/provider-registry.js packages/brain/src/orchestrator/providers packages/brain/src/orchestrator/__tests__/provider-registry.test.js packages/brain/src/orchestrator/__tests__/provider-adapters.test.js
    git commit -m "feat(harness): add Claude and Codex provider adapters"

### Task 5: Persist attempts and enforce adversarial isolation

**Files:**
- Create: packages/brain/src/orchestrator/attempt-store.js
- Create: packages/brain/src/orchestrator/__tests__/attempt-store.test.js

- [ ] **Step 1: Write failing persistence and isolation tests**

    it('creates one attempt per run hop idempotently', async () => {
      await store.createAttempt(input);
      expect(allSql()).toMatch(/ON CONFLICT \(run_id, hop\)/);
    });

    it('rejects proposer session reuse by reviewer', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ role: 'proposer', provider_session_id: 'same' }]
      });
      await expect(store.assertFreshRoleSession({
        runId,
        role: 'reviewer',
        sessionId: 'same'
      })).rejects.toThrow(/role_session_reuse/);
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/orchestrator/__tests__/attempt-store.test.js

- [ ] **Step 3: Implement store operations**

Implement createAttempt, markStarting, markRunning, heartbeat, complete, fail, getById, getByRunHop, and assertFreshRoleSession. Terminal writes use WHERE status NOT IN terminal states so duplicate callbacks are idempotent.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/orchestrator/__tests__/attempt-store.test.js
    git add packages/brain/src/orchestrator/attempt-store.js packages/brain/src/orchestrator/__tests__/attempt-store.test.js
    git commit -m "feat(harness): persist isolated execution attempts"

### Task 6: Complete the existing Kernel dispatcher

**Files:**
- Create: packages/brain/src/orchestrator/dispatcher.js
- Create: packages/brain/src/orchestrator/__tests__/dispatcher.test.js
- Modify: packages/brain/src/orchestrator/run.js
- Modify: packages/brain/src/orchestrator/__tests__/run.test.js

- [ ] **Step 1: Write failing action mapping/order tests**

    it.each([
      ['spawn:planner', 'planner', 'harness-planner'],
      ['spawn:proposer', 'proposer', 'harness-contract-proposer'],
      ['spawn:reviewer', 'reviewer', 'harness-contract-reviewer'],
      ['spawn:generator', 'generator', 'harness-generator'],
      ['spawn:evaluator', 'evaluator', 'harness-evaluator'],
      ['spawn:judge', 'judge', null]
    ])('%s maps to isolated %s/%s', (action, role, skill) => {
      expect(resolveAction(action)).toMatchObject({ role, skill });
    });

    it('persists the attempt before launch', async () => {
      await dispatch('spawn:reviewer', ctx);
      expect(callOrder()).toEqual(['attempt.create', 'adapter.start', 'launcher.launch']);
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/orchestrator/__tests__/dispatcher.test.js src/orchestrator/__tests__/run.test.js

- [ ] **Step 3: Implement dispatcher and real dependency assembly**

Build and validate TaskBundle, create the attempt, resolve task.payload.executor or auto, create the adapter descriptor, launch through an injected launcher, and return an existing Kernel four-state result. The judge action creates an isolated attempt and delegates to the existing harness-judge.js evidence gate; merge/report/human-review remain explicit deterministic handlers.

- [ ] **Step 4: Verify Kernel regression set and commit**

    npx vitest run src/orchestrator/__tests__/dispatcher.test.js src/orchestrator/__tests__/run.test.js src/orchestrator/__tests__/loop.test.js src/orchestrator/__tests__/derive.test.js src/orchestrator/__tests__/gates.test.js
    git add packages/brain/src/orchestrator/dispatcher.js packages/brain/src/orchestrator/run.js packages/brain/src/orchestrator/__tests__/dispatcher.test.js packages/brain/src/orchestrator/__tests__/run.test.js
    git commit -m "feat(harness): complete provider-neutral kernel dispatcher"

### Task 7: Add structured runner and internal attempt callback

**Files:**
- Modify: docker/cecelia-runner/entrypoint.sh
- Modify: packages/brain/src/routes/harness-callback.js
- Create: packages/brain/src/routes/__tests__/harness-attempt-callback.test.js
- Create: docker/cecelia-runner/entrypoint-provider-contract.test.sh

- [ ] **Step 1: Write failing callback and shell tests**

    it('completes an attempt idempotently', async () => {
      const first = await request(app)
        .post('/api/brain/harness/attempts/11111111-1111-4111-8111-111111111111/callback')
        .send(validResult);
      const second = await request(app)
        .post('/api/brain/harness/attempts/11111111-1111-4111-8111-111111111111/callback')
        .send(validResult);
      expect(first.status).toBe(200);
      expect(second.body.deduped).toBe(true);
    });

The Bash test must assert that the Codex branch includes --json, --output-schema, --output-last-message, captures thread.started, and does not hardcode --model.

- [ ] **Step 2: Verify RED**

    npx vitest run src/routes/__tests__/harness-attempt-callback.test.js
    bash docker/cecelia-runner/entrypoint-provider-contract.test.sh

- [ ] **Step 3: Implement structured execution and callback**

The runner reads HARNESS_TASK_BUNDLE_FILE, invokes the selected adapter command, writes normalized result JSON, and POSTs to /api/brain/harness/attempts/:id/callback. Preserve the current legacy callback path unchanged.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/routes/__tests__/harness-attempt-callback.test.js
    bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
    git add docker/cecelia-runner/entrypoint.sh docker/cecelia-runner/entrypoint-provider-contract.test.sh packages/brain/src/routes/harness-callback.js packages/brain/src/routes/__tests__/harness-attempt-callback.test.js
    git commit -m "feat(harness): add structured provider runner callbacks"

### Task 8: Wire opt-in Kernel rollout and attempt-aware recovery

**Files:**
- Modify: packages/brain/src/harness-skill-relay.js
- Modify: packages/brain/src/__tests__/harness-skill-relay.test.js
- Modify: packages/brain/src/harness-relay-watchdog.js
- Modify: packages/brain/src/__tests__/harness-relay-watchdog.test.js

- [ ] **Step 1: Write failing rollout tests**

    it('kernel-v1 launches orchestrator without loading harness-controller', async () => {
      await spawnSkillRelaySession(kernelTask, deps);
      expect(deps.launchKernel).toHaveBeenCalledOnce();
      expect(deps.loadSkill).not.toHaveBeenCalledWith('harness-controller');
    });

    it('legacy/default keeps the controller rollback path', async () => {
      await spawnSkillRelaySession(legacyTask, deps);
      expect(deps.spawnFn).toHaveBeenCalledOnce();
    });

- [ ] **Step 2: Verify RED**

    npx vitest run src/__tests__/harness-skill-relay.test.js src/__tests__/harness-relay-watchdog.test.js

- [ ] **Step 3: Implement feature flag and recovery**

Use payload.harness_runtime === 'kernel-v1' as opt-in. Recovery checks the latest nonterminal attempt: resume only the same attempt/session when supported; otherwise let the reconcile loop derive a new hop from Git/PR/DB. Do not change legacy behavior.

- [ ] **Step 4: Verify GREEN and commit**

    npx vitest run src/__tests__/harness-skill-relay.test.js src/__tests__/harness-relay-watchdog.test.js
    git add packages/brain/src/harness-skill-relay.js packages/brain/src/harness-relay-watchdog.js packages/brain/src/__tests__/harness-skill-relay.test.js packages/brain/src/__tests__/harness-relay-watchdog.test.js
    git commit -m "feat(harness): wire opt-in provider-neutral kernel runtime"

### Task 9: Version, documentation, and final scoped verification

**Files:**
- Modify: packages/brain/DEFINITION.md and every Brain version-sync file reported by scripts/check-version-sync.sh
- Modify: packages/brain/src/orchestrator/README.md
- Modify: the Brain feature/changelog registry required by DevGate

- [ ] **Step 1: Update documentation and patch versions**

Document harness_runtime=kernel-v1, adapter capabilities, isolation invariants, rollback, and the unrelated baseline failures. Increment Brain patch version consistently.

- [ ] **Step 2: Run the complete scoped suite**

From packages/brain:

    npx vitest run \
      src/orchestrator/__tests__/execution-contract.test.js \
      src/orchestrator/__tests__/skill-bundle.test.js \
      src/orchestrator/__tests__/provider-registry.test.js \
      src/orchestrator/__tests__/provider-adapters.test.js \
      src/orchestrator/__tests__/attempt-store.test.js \
      src/orchestrator/__tests__/dispatcher.test.js \
      src/orchestrator/__tests__/loop.test.js \
      src/orchestrator/__tests__/derive.test.js \
      src/orchestrator/__tests__/gates.test.js \
      src/routes/__tests__/harness-attempt-callback.test.js \
      src/__tests__/harness-skill-relay.test.js \
      src/__tests__/harness-relay-watchdog.test.js

Expected: every selected test passes.

- [ ] **Step 3: Run DevGate**

    node packages/engine/scripts/devgate/check-dod-mapping.cjs
    node scripts/devgate/scan-rci-coverage.cjs
    bash scripts/devgate/require-rci-update-if-p0p1.sh
    bash scripts/check-version-sync.sh
    git diff --check

Expected: exit 0. Add only the exact RCI/feature/version entries named by a failing gate, then rerun.

- [ ] **Step 4: Review and commit**

    git status --short
    git add packages/brain docker docs scripts
    git commit -m "docs(harness): document provider-neutral kernel rollout"

## Execution note

The clean worktree full npm test baseline was run before implementation and produced unrelated Cannot read properties of null (reading 'port') failures plus Node OOM. The user explicitly authorized continuing. Completion claims for this work therefore require fresh scoped Harness tests and DevGate evidence, while the pre-existing full-suite failure remains disclosed.
