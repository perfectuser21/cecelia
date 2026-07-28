# Harness Commander Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` or `superpowers:subagent-driven-development`
> to execute this plan task by task. Every behavior change follows
> `superpowers:test-driven-development`; every completion claim follows
> `superpowers:verification-before-completion`.

**Goal:** Make Commander a real, opt-in, provider-neutral Harness role that
receives a per-Run `CommanderBundle`, returns one validated
`CommanderDirective`, wakes only at material Run boundaries, persists memory
and cursor progress, and can recover onto a declared Provider fallback without
changing the existing Kernel process truth.

**Architecture:** Keep `derive.js` pure and unchanged as the default Kernel
decision source. Add a Commander coordinator between `derive()` and the
existing loop/dispatcher side-effect boundary. For `commander_mode=hybrid`,
the coordinator may pause the default decision, create a normal
`harness_attempts.role='commander'` Attempt through the existing dispatcher,
and later adjudicate the returned Directive through L0. The authoritative
state remains `initiative_runs`, `harness_attempts`, and
`orchestrator_decision_log`; `harness_run_events` remains a rebuildable audit
projection. `kernel-only` and `legacy-session` Runs bypass the coordinator and
must remain behaviorally identical to current `main`.

**Tech Stack:** Node.js ESM, Zod 3/4-compatible schemas, PostgreSQL 16,
existing Provider Registry and Claude/Codex/Grok adapters, Bash Runner
contract, Vitest, real PostgreSQL integration tests.

---

## Dependency graph and delivery boundary

```text
Phase 0B capability snapshot/fallback + Phase 1 state/events/contracts
                              │
                              ▼
 Task 1 migration 368 + formal Commander Task/Result contract
                 ┌────────────┴────────────┐
                 ▼                         ▼
      Task 2 RunProfile/wakeup       Task 3 Runner/adapter I/O
                 └────────────┬────────────┘
                              ▼
              Task 4 Commander coordinator/memory
                              │
                              ▼
           Task 5 dispatcher + callback persistence
                              │
                              ▼
           Task 6 L0 adjudication + loop wake wiring
                              │
                              ▼
           Task 7 infrastructure-only Provider failover
                              │
                              ▼
           Task 8 version, smoke, DevGate, PR and merge
```

Phase 2 is one independently reversible implementation PR after this plan PR
is merged. The implementation PR may create or modify only:

- Create `packages/brain/migrations/368_harness_commander_phase2.sql`
- Create `packages/brain/src/__tests__/migration-368-harness-commander-phase2.test.js`
- Create `packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js`
- Create `packages/brain/src/orchestrator/commander-profile.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-profile.test.js`
- Create `packages/brain/src/orchestrator/commander-wakeup.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-wakeup.test.js`
- Create `packages/brain/src/orchestrator/commander-coordinator.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-coordinator.test.js`
- Create `packages/brain/src/orchestrator/commander-directive-executor.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-directive-executor.test.js`
- Create `packages/brain/scripts/smoke/harness-commander-phase2-smoke.sh`
- Modify `packages/brain/src/orchestrator/execution-contract.js`
- Modify `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Modify `packages/brain/src/orchestrator/providers/shared.js`
- Modify `packages/brain/src/orchestrator/providers/shared.test.js`
- Modify `packages/brain/src/orchestrator/providers/claude.test.js`
- Modify `packages/brain/src/orchestrator/providers/codex.test.js`
- Modify `packages/brain/src/orchestrator/providers/grok.test.js`
- Modify `packages/brain/src/orchestrator/dispatcher.js`
- Modify `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify `packages/brain/src/orchestrator/loop.js`
- Modify `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Modify `packages/brain/src/orchestrator/run.js`
- Modify `packages/brain/src/orchestrator/__tests__/run.test.js`
- Modify `packages/brain/src/orchestrator/directive-validator.js`
- Modify `packages/brain/src/orchestrator/__tests__/directive-validator.test.js`
- Modify `packages/brain/src/orchestrator/commander-store.js`
- Modify `packages/brain/src/orchestrator/__tests__/commander-store.test.js`
- Modify `packages/brain/src/orchestrator/attempt-store.js`
- Modify `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Modify `packages/brain/src/routes/harness-callback.js`
- Modify `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`
- Modify `docker/cecelia-runner/entrypoint.sh`
- Modify `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Modify `packages/brain/src/orchestrator/README.md`
- Modify `packages/quality/smoke-allowlist.txt`
- Modify `packages/brain/DEFINITION.md`
- Modify `DEFINITION.md`
- Modify `packages/brain/package.json`
- Modify `packages/brain/package-lock.json`
- Modify `package-lock.json`
- Modify `.brain-versions`

Explicitly out of scope:

- no default change away from `kernel-only`;
- no Phase 3 machine-routing implementation or new routing matrix;
- no execution of `switch_machine` or role-level `switch_provider` Directive;
- no Phase 4 node installation, OrbStack bootstrap, credential copying, or
  deployment to US/Xian machines;
- no Phase 5 real Provider canary or synthetic canary claimed as acceptance;
- no Xian-local long-lived Codex credential and no credential material in
  Commander bundles, events, logs, results, or tests;
- no direct Commander database mutation, merge, production promote, or bypass
  of existing Kernel gates;
- no Provider/account/model branch in `derive.js`;
- no new scheduler, sidecar, LangGraph, workflow registry, or second process
  truth.

## Fixed Phase 2 semantics

These are implementation decisions, not open choices:

1. A Commander call is a normal `harness_attempts` row with
   `role='commander'`, a fresh Provider session, lease, heartbeat, callback,
   execution receipt, and terminal result.
2. The Provider returns a direct `commander-directive/v1` object. The Runner
   wraps it in the existing transport `HarnessResult` envelope under
   `decision` before callback. This reuses Attempt lifecycle persistence while
   keeping the LLM-facing output Provider-neutral.
3. Directive staleness is measured against the bundle cursor. Lifecycle
   events produced by that exact Commander Attempt are control noise and do
   not make its own Directive stale. Any later material event from another
   source does make it stale.
4. Accepted and rejected Directives are authoritative
   `orchestrator_decision_log` records. Migration 368 projects those records
   into `harness_run_events`; application code must not dual-write both.
5. Phase 2 L0 can execute `continue_default`, `dispatch_role`,
   `retry_attempt`, `revise_guidance`, `pause_run`, `request_human`, and
   `abort_run`. `dispatch_role` may only select the role already legal at the
   current Kernel boundary. `retry_attempt` may only retry the evidenced
   terminal Attempt while preserving its `logical_cycle_id`.
6. `switch_provider` and `switch_machine` remain valid contract values but
   are rejected with `phase2_route_mutation_deferred`; role-level route
   mutation belongs to Phase 3. Commander’s own infrastructure failover is
   handled deterministically by L0 and is not a Directive side effect.
7. Cross-Provider Commander failover is allowed only for bounded
   infrastructure/Provider codes. Semantic refusal, Reviewer rejection,
   Evaluator product failure, an invalid Directive, or ordinary healthy
   polling never causes cross-Provider failover.

### Task 1: Add the formal Commander Attempt and transport contracts

**Files:**

- Create: `packages/brain/migrations/368_harness_commander_phase2.sql`
- Create: `packages/brain/src/__tests__/migration-368-harness-commander-phase2.test.js`
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`

- [ ] **Step 1: Write and commit Red tests**

The migration Red test must require migration `368` to replace only the
existing `harness_attempts_role_check` and add `commander` without removing
the seven existing roles. The execution-contract Red test must prove:

- `ROLE_VALUES` includes `commander`;
- a Commander TaskBundle requires `inputs.commander_bundle`;
- TaskBundle `run_id` and `attempt_id` match the nested CommanderBundle;
- `expected_output` is exactly `commander-directive/v1`;
- a Commander callback accepts a valid Directive in `decision`;
- an invalid schema, run id, attempt id, or unknown field is rejected.

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-368-harness-commander-phase2.test.js \
  src/orchestrator/__tests__/execution-contract.test.js
```

Expected Red: migration 368 does not exist, `commander` is not a TaskBundle
role, and Commander results are not recognized.

Commit:

```bash
git add src/__tests__/migration-368-harness-commander-phase2.test.js \
  src/orchestrator/__tests__/execution-contract.test.js
git commit -m "test(harness): specify Commander Phase 2 transport (Red)"
```

- [ ] **Step 2: Implement migration and schema Green**

Use `z.string().uuid()` only; Phase 1 proved the production container can
resolve Zod 3. Do not duplicate the Directive schema: import and call
`parseCommanderBundle` / `parseCommanderDirective`.

For Commander `parseHarnessResult`, require:

```js
{
  contract_version: '1.0',
  attempt_id: '<commander attempt>',
  status: 'completed',
  summary: '<bounded directive reason>',
  artifacts: [],
  checks: [],
  decision: { schema: 'commander-directive/v1', ... },
  error: null,
  provider_metadata: { provider: '<registered provider>', session_id: '<id>' }
}
```

Non-success transport states remain persistable, but may not carry a
Directive.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-368-harness-commander-phase2.test.js \
  src/orchestrator/__tests__/execution-contract.test.js
git add migrations/368_harness_commander_phase2.sql \
  src/orchestrator/execution-contract.js \
  src/orchestrator/__tests__/execution-contract.test.js
git commit -m "feat(harness): formalize Commander attempts and results"
```

### Task 2: Parse RunProfile and classify material wakeups

**Files:**

- Create: `packages/brain/src/orchestrator/commander-profile.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-profile.test.js`
- Create: `packages/brain/src/orchestrator/commander-wakeup.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-wakeup.test.js`

- [ ] **Step 1: Write and commit Red tests**

Profile tests must prove:

- `commander.primary` and ordered `commander.fallbacks` parse five independent
  axes without deriving machine from account or Provider;
- unknown keys, duplicate targets, missing Provider/account, secret-shaped
  keys, and more than three fallbacks reject;
- no Commander config is required for `kernel-only`;
- `hybrid` without an explicit primary target loud-fails.

Wakeup tests must use real Phase 1 event shapes and prove:

- Run creation, non-Commander Attempt completion/failure, phase change,
  pre-merge, pre-terminal, unknown failure, and Actor messages wake;
- heartbeat, healthy CI polling, accepted/rejected Directive projection, and
  lifecycle events belonging to the current Commander Attempt do not wake;
- event order is deterministic and Run A events cannot wake Run B;
- a material event after the bundle cursor makes a result stale;
- only the current Commander Attempt’s own lifecycle events are ignored for
  self-staleness.

Expected Red:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-profile.test.js \
  src/orchestrator/__tests__/commander-wakeup.test.js
```

Commit:

```bash
git add src/orchestrator/__tests__/commander-profile.test.js \
  src/orchestrator/__tests__/commander-wakeup.test.js
git commit -m "test(harness): specify Commander profiles and wakeups (Red)"
```

- [ ] **Step 2: Implement pure parsers/classifiers**

Both modules must be pure. They may not read DB, filesystem, environment,
network, Provider state, or current machine identity.

Export a small API:

```js
parseCommanderProfile({ commanderMode, payload })
classifyCommanderWakeup({ runId, stateCursor, events, defaultDecision })
materialEventsAfter({ runId, bundleCursor, events, commanderAttemptId })
```

The wake classifier returns bounded reason codes and the exact event evidence;
it never launches an Attempt.

- [ ] **Step 3: Run Green and commit**

```bash
npx vitest run \
  src/orchestrator/__tests__/commander-profile.test.js \
  src/orchestrator/__tests__/commander-wakeup.test.js
git add src/orchestrator/commander-profile.js \
  src/orchestrator/commander-wakeup.js \
  src/orchestrator/__tests__/commander-profile.test.js \
  src/orchestrator/__tests__/commander-wakeup.test.js
git commit -m "feat(harness): classify bounded Commander wakeups"
```

### Task 3: Make all three Provider runners speak the same Directive contract

**Files:**

- Modify: `packages/brain/src/orchestrator/providers/shared.js`
- Modify: `packages/brain/src/orchestrator/providers/shared.test.js`
- Modify: `packages/brain/src/orchestrator/providers/claude.test.js`
- Modify: `packages/brain/src/orchestrator/providers/codex.test.js`
- Modify: `packages/brain/src/orchestrator/providers/grok.test.js`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`

- [ ] **Step 1: Write and commit Red adapter/Runner tests**

Use one frozen CommanderBundle and one frozen Directive fixture for Claude,
Codex, and Grok. Each adapter test must prove the same normalized transport
result and Provider-specific session extraction. The shell contract test must
prove:

- Runner selects a strict Directive JSON schema only when
  `task_bundle.expected_output == "commander-directive/v1"`;
- the direct Provider output is wrapped into a HarnessResult with empty
  artifacts/checks and the Directive under `decision`;
- ordinary role output remains byte-for-byte compatible with the existing
  HarnessResult path;
- Commander cannot receive role Skill content or a writable workspace;
- callback credentials remain available; this is not the canary path that
  unsets callback variables.

Run Red:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/providers/shared.test.js \
  src/orchestrator/providers/claude.test.js \
  src/orchestrator/providers/codex.test.js \
  src/orchestrator/providers/grok.test.js
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
```

Commit the tests before changing Provider or Runner code.

- [ ] **Step 2: Implement shared normalization and Runner schema selection**

Provider-specific branches may only parse their native wrapper/session. The
CommanderBundle, Directive schema, transport status, and control meaning stay
in shared code.

The Commander Runner contract is observational:

- read-only workspace;
- no role Skill;
- no merge/deploy/DB API;
- exact structured output only;
- normal heartbeat and callback remain active.

Do not copy `CANARY_NO_TOOL_ARGS` wholesale because it unsets callback
credentials. Add only the minimum role-specific CLI restrictions already
supported by the installed CLIs, and lock every flag with the shell contract.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/providers/shared.test.js \
  src/orchestrator/providers/claude.test.js \
  src/orchestrator/providers/codex.test.js \
  src/orchestrator/providers/grok.test.js
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
git add packages/brain/src/orchestrator/providers \
  docker/cecelia-runner/entrypoint.sh \
  docker/cecelia-runner/entrypoint-provider-contract.test.sh
git commit -m "feat(harness): normalize Commander directives across providers"
```

### Task 4: Build the isolated Commander coordinator and recoverable memory

**Files:**

- Create: `packages/brain/src/orchestrator/commander-coordinator.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-coordinator.test.js`
- Modify: `packages/brain/src/orchestrator/commander-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/commander-store.test.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`

- [ ] **Step 1: Write and commit Red tests**

Coordinator tests must use injected stores and prove:

- `kernel-only`/`legacy-session` are exact no-op bypasses;
- a hybrid Run with a material wake builds one bundle from only that Run’s
  state, events, Actor messages, profile, budgets, and allowed actions;
- an in-flight Commander Attempt causes wait, not duplicate launch;
- a completed result is consumed once;
- accepted/rejected result processing uses compare-and-set cursor advancement;
- self lifecycle events advance the consumed cursor without invalidating the
  result;
- concurrent material events reject stale output and schedule a fresh
  observation;
- Provider session, strategy summary, risks, and guidance survive creation of
  a new Commander Attempt;
- raw prompts, Provider output, error text, callback secrets, credentials, and
  cross-Run rows never enter the next bundle.

Attempt-store tests must add bounded queries for the latest Commander Attempt
and failover lineage; do not make the coordinator scan all Attempts in
application memory.

- [ ] **Step 2: Implement coordinator**

Export one injected factory:

```js
createCommanderCoordinator({
  commanderStore,
  eventStore,
  actorInbox,
  attemptStore,
  appendDecision,
  nextHop,
  now,
})
```

Its reconciliation result is data, not a side effect:

```js
{ kind: 'bypass' }
{ kind: 'wait', reason }
{ kind: 'dispatch', action: 'spawn:commander', context }
{ kind: 'continue', decision }
{ kind: 'control', decision }
```

Only injected stores may perform I/O. The coordinator may update Commander
memory/cursor and append authoritative decision records; it may not launch a
Provider or modify core Run state directly.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-coordinator.test.js \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/attempt-store.test.js
git add src/orchestrator/commander-coordinator.js \
  src/orchestrator/commander-store.js \
  src/orchestrator/attempt-store.js \
  src/orchestrator/__tests__/commander-coordinator.test.js \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/attempt-store.test.js
git commit -m "feat(harness): coordinate isolated Commander memory"
```

### Task 5: Dispatch Commander through the existing capability-gated Attempt path

**Files:**

- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: Write and commit Red tests**

Dispatcher Red tests must prove:

- `spawn:commander` resolves to `role=commander`, no Skill, read-only, and
  expected output `commander-directive/v1`;
- its TaskBundle contains the exact frozen CommanderBundle;
- primary/fallback Provider, account, model, and machine remain separate axes;
- Phase 0B preflight runs before Attempt creation;
- missing/expired capability snapshots create no Attempt;
- failover Attempts have a new id/session, preserve the wakeup logical cycle,
  and set `retry_of_attempt_id`;
- no Commander config is inferred from ordinary role assignments.

Callback Red tests must prove valid Directives persist as terminal Commander
Attempt results and malformed/stale-looking transport payloads are rejected
before persistence. Semantic staleness is adjudicated later by the coordinator,
not by the HTTP route.

- [ ] **Step 2: Implement dispatcher/callback Green**

Add `spawn:commander` to `ACTION_SPECS`; do not add Provider branches to
`derive.js`. The coordinator supplies a validated profile and
CommanderBundle. Dispatcher still owns:

- Provider Registry resolution;
- Phase 0B capability snapshot/fallback;
- account home/credential boundary;
- Attempt creation and callback secret;
- lease and execution receipt;
- Provider launch.

Callback remains a generic Attempt terminal persistence endpoint.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/routes/__tests__/harness-attempt-callback.test.js
git add src/orchestrator/dispatcher.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/routes/harness-callback.js \
  src/routes/__tests__/harness-attempt-callback.test.js
git commit -m "feat(harness): dispatch Commander through Provider registry"
```

### Task 6: Adjudicate Directives in L0 and wire material wakeups into the loop

**Files:**

- Create: `packages/brain/src/orchestrator/commander-directive-executor.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-directive-executor.test.js`
- Modify: `packages/brain/src/orchestrator/directive-validator.js`
- Modify: `packages/brain/src/orchestrator/__tests__/directive-validator.test.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Modify: `packages/brain/src/orchestrator/run.js`
- Modify: `packages/brain/src/orchestrator/__tests__/run.test.js`
- Modify: `packages/brain/migrations/368_harness_commander_phase2.sql`
- Create: `packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js`

- [ ] **Step 1: Write and commit Red tests**

Directive-executor tests must prove:

- `continue_default` returns the fresh `derive()` decision unchanged;
- `dispatch_role` cannot select a role illegal at the current Kernel boundary;
- `retry_attempt` requires owned Attempt/event evidence, a terminal source
  Attempt, remaining budget, and preserves logical-cycle lineage;
- `revise_guidance` changes only Commander memory;
- `pause_run`, `request_human`, and `abort_run` map to bounded Kernel control
  decisions and never merge/deploy;
- `switch_provider`/`switch_machine` reject with
  `phase2_route_mutation_deferred`;
- stale cursor, duplicate hop, strict affinity, capability, evidence, cost,
  hop, and deadline fences still reject.

Loop tests must prove:

- non-hybrid Runs have the exact previous dispatch sequence;
- hybrid material boundaries insert one Commander Attempt before the default
  action;
- heartbeat/healthy polling do not call Commander;
- pre-merge and pre-terminal decisions wake Commander before side effects;
- rejected Directive records a bounded reason and re-derives from current
  truth;
- accepted Directive is consumed once across process restart;
- Commander cannot directly call DB, dispatcher, merge, or deployment.

The PostgreSQL integration test must prove the complete local chain:

```text
Run event
  → Commander Attempt row
  → terminal callback-shaped result
  → directive proposed decision log
  → L0 accepted/rejected decision log
  → projected immutable run events
  → cursor/memory update
```

Run Red and commit tests before implementation.

- [ ] **Step 2: Implement L0/loop wiring**

Call the coordinator after collecting ground truth and computing the fresh
default `derive()` decision, but before any terminal/control/dispatch side
effect. Keep `derive.js` byte-for-byte unchanged.

Migration 368 may extend the existing decision-event projection trigger for:

- `commander.directive_proposed`
- `commander.directive_accepted`
- `commander.directive_rejected`
- `commander.failover_started`
- `commander.failover_completed`

The authoritative decision row and projection insert must share one database
transaction or database trigger. Do not append the same event from JavaScript.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-directive-executor.test.js \
  src/orchestrator/__tests__/directive-validator.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/run.test.js \
  src/__tests__/integration/harness-commander-phase2.integration.test.js
git add migrations/368_harness_commander_phase2.sql \
  src/orchestrator/commander-directive-executor.js \
  src/orchestrator/directive-validator.js \
  src/orchestrator/loop.js \
  src/orchestrator/run.js \
  src/orchestrator/__tests__/commander-directive-executor.test.js \
  src/orchestrator/__tests__/directive-validator.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/run.test.js \
  src/__tests__/integration/harness-commander-phase2.integration.test.js
git commit -m "feat(harness): wire Commander decisions through L0"
```

### Task 7: Add bounded infrastructure-only Commander failover

**Files:**

- Modify: `packages/brain/src/orchestrator/commander-coordinator.js`
- Modify: `packages/brain/src/orchestrator/__tests__/commander-coordinator.test.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js`

- [ ] **Step 1: Write and commit Red tests**

Test the declared ordered profile:

```yaml
primary:  { provider: codex, account: team4, machine: us-mac-m4 }
fallbacks:
  - { provider: claude, account: account1, machine: us-mac-m4 }
  - { provider: grok, account: grok, machine: us-mac-m4 }
```

Required cases:

- one bounded Phase 0B transient retry stays on the current target;
- exhausted/auth/rate-limit/5xx/provider-unavailable/session-unrecoverable/
  launch-failed Commander Attempt advances to the first legal fallback;
- new Attempt has a new id and empty Provider session, preserves
  `logical_cycle_id`, and points `retry_of_attempt_id` to the failed Attempt;
- failed and replacement Attempts remain auditable;
- semantic refusal, contract invalidity, Reviewer rejection, Evaluator product
  failure, and unknown free text never trigger cross-Provider failover;
- strict affinity and the verified execution matrix still fail closed;
- exhausting all declared targets returns `request_human`, not silent
  `kernel-only` fallback and not a synthetic success.

- [ ] **Step 2: Implement bounded classification/failover**

Use an explicit error-code allowlist and persisted `failure_class`; never
regex free-form error text. Reuse Phase 0B candidate ordering and failed-target
evidence. Emit failover decision rows through the migration trigger.

- [ ] **Step 3: Run Green and commit**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-coordinator.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/__tests__/integration/harness-commander-phase2.integration.test.js
git add src/orchestrator/commander-coordinator.js \
  src/orchestrator/dispatcher.js \
  src/orchestrator/__tests__/commander-coordinator.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/__tests__/integration/harness-commander-phase2.integration.test.js
git commit -m "feat(harness): fail over Commander infrastructure attempts"
```

### Task 8: Version, smoke, verify, self-review, and publish Phase 2

**Files:**

- Create: `packages/brain/scripts/smoke/harness-commander-phase2-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Modify: `packages/brain/src/orchestrator/README.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`

- [ ] **Step 1: Add the real Phase 2 smoke**

The smoke must run the exact permanent contract, coordinator, dispatcher,
loop, callback, Runner shell, and PostgreSQL integration tests added above. It
must not be a static file-existence-only smoke and must not call a real
Provider.

- [ ] **Step 2: Bump the Brain patch version exactly once**

Rebase on the then-current `origin/main` first and choose the next unused patch
version. Document:

- hybrid is opt-in and `kernel-only` remains default;
- Commander is a real Attempt but L0 remains authoritative;
- cross-Provider failover is infrastructure-only;
- role-level Provider/machine switching, deployment, and canary remain Phase
  3/5 work;
- rollback is the immediately previous Brain version.

- [ ] **Step 3: Run the focused Phase 2 suite**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-368-harness-commander-phase2.test.js \
  src/__tests__/integration/harness-commander-phase2.integration.test.js \
  src/orchestrator/__tests__/commander-profile.test.js \
  src/orchestrator/__tests__/commander-wakeup.test.js \
  src/orchestrator/__tests__/commander-coordinator.test.js \
  src/orchestrator/__tests__/commander-directive-executor.test.js \
  src/orchestrator/__tests__/execution-contract.test.js \
  src/orchestrator/__tests__/directive-validator.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/run.test.js \
  src/orchestrator/providers/shared.test.js \
  src/orchestrator/providers/claude.test.js \
  src/orchestrator/providers/codex.test.js \
  src/orchestrator/providers/grok.test.js \
  src/routes/__tests__/harness-attempt-callback.test.js
cd ../..
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash packages/brain/scripts/smoke/harness-commander-phase2-smoke.sh
```

- [ ] **Step 4: Run repository gates**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash scripts/ci/check-branch-naming.sh "$(git branch --show-current)"
bash scripts/ci/run-core-regression.sh --tier pr
git diff --check origin/main...HEAD
```

Push normally so the repository QuickCheck hook runs. Do not use
`--no-verify`, `--admin`, or a bypass environment variable.

- [ ] **Step 5: Self-review against the PRD**

Verify line by line:

- `derive.js` is unchanged and has no Provider/account/model/machine branch;
- non-hybrid Runs retain the exact current dispatch sequence;
- Run A state/events/messages/results never enter Run B bundles;
- own Commander lifecycle events do not self-stale a Directive, while any
  concurrent material event does;
- accepted/rejected/failover decisions are replayable from authoritative rows
  and projection events;
- all Commander Attempts use Provider Registry, Phase 0B preflight, Attempt
  lease, callback auth, and execution receipts;
- Provider failover never reuses a session and never follows semantic failure;
- L0 rejects stale cursor, illegal role, deferred route mutation, strict
  affinity, capability, evidence, budget, deadline, and duplicate-hop cases;
- no Directive can merge, deploy, promote, write core state directly, or
  bypass existing gates;
- no credential, auth file, callback secret, raw prompt, raw Provider output,
  or Xian-local long-lived token is persisted or exposed;
- no deployment or canary claim is made.

- [ ] **Step 6: Publish and merge the independent Phase 2 PR**

Use a fresh compliant `cp-<timestamp>-commander-phase2` implementation branch
from current `origin/main`. Open a draft PR, inspect the complete diff, mark it
ready, wait for all CI including production-container Smoke Glob and
`real-env-smoke`, fix actionable failures with new Red/Green commits, and
squash-merge without `--admin`. Do not deploy or start Phase 3 until this PR is
confirmed merged.
