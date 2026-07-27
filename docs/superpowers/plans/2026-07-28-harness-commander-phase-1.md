# Harness Commander Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the provider-neutral Commander contracts, per-Run persistent state, rebuildable event projection, Harness Actor Inbox, and deterministic Directive validation required before any LLM Commander is allowed to cause side effects.

**Architecture:** Keep the existing Kernel Run Controller and its authoritative `initiative_runs`, `harness_attempts`, and `orchestrator_decision_log` tables unchanged as the process truth. Add one additive migration for Commander state, immutable Run event projection, immutable Actor messages, delivery state, and actor cursors. PostgreSQL triggers project Attempt and decision changes transactionally; application stores append Commander and Actor events through one idempotent SQL function. Phase 1 validates and records data only: it does not call a Provider, create Commander Attempts, or execute a Directive.

**Tech Stack:** Node.js ESM, Zod, PostgreSQL 16, Express, Vitest, real PostgreSQL migration integration tests.

---

## Dependency graph and PR boundary

```text
Phase 0C Attempt telemetry + existing authoritative Kernel tables
                         │
                         ▼
Task 1 migration 367: mode/state/events/messages/delivery/cursors
             ┌───────────┼────────────┐
             ▼           ▼            ▼
Task 2 contracts   Task 3 stores   Task 4 Actor Inbox
             └───────────┼────────────┘
                         ▼
          Task 5 Bundle builder + Directive validator
                         │
                         ▼
          Task 6 transactional projection wiring
                         │
                         ▼
          Task 7 read-only observability API
                         │
                         ▼
          Task 8 version, DevGate, self-review, PR
```

This is one independently reversible Phase 1 PR. It may create or modify only:

- Create `packages/brain/migrations/367_harness_commander_phase1.sql`
- Create `packages/brain/src/__tests__/migration-367-harness-commander-phase1.test.js`
- Create `packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js`
- Create `packages/brain/src/orchestrator/commander-contract.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-contract.test.js`
- Create `packages/brain/src/orchestrator/commander-store.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-store.test.js`
- Create `packages/brain/src/orchestrator/run-event-store.js`
- Create `packages/brain/src/orchestrator/__tests__/run-event-store.test.js`
- Create `packages/brain/src/orchestrator/actor-inbox.js`
- Create `packages/brain/src/orchestrator/__tests__/actor-inbox.test.js`
- Create `packages/brain/src/orchestrator/commander-bundle.js`
- Create `packages/brain/src/orchestrator/__tests__/commander-bundle.test.js`
- Create `packages/brain/src/orchestrator/directive-validator.js`
- Create `packages/brain/src/orchestrator/__tests__/directive-validator.test.js`
- Create `packages/brain/src/routes/harness-commander.js`
- Create `packages/brain/src/routes/__tests__/harness-commander.test.js`
- Modify `packages/brain/src/orchestrator/decision-log.js`
- Modify `packages/brain/src/orchestrator/__tests__/decision-log.test.js`
- Modify `packages/brain/src/orchestrator/attempt-store.js`
- Modify `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Modify `packages/brain/server.js`
- Modify `packages/brain/DEFINITION.md`
- Modify `DEFINITION.md`
- Modify `packages/brain/package.json`
- Modify `packages/brain/package-lock.json`
- Modify `package-lock.json`
- Modify `.brain-versions`
- Modify this plan only for checked completion boxes or corrections found before implementation begins

Explicitly out of scope:

- no Provider adapter call and no Commander Prompt;
- no `commander` role in `harness_attempts` until Phase 2;
- no Directive execution or Kernel phase override;
- no machine deployment or production canary;
- no default change away from `kernel-only`;
- no Xian-local long-lived Codex credential.

### Task 1: Add the additive Phase 1 schema and transaction-safe event projection

**Files:**

- Create: `packages/brain/migrations/367_harness_commander_phase1.sql`
- Create: `packages/brain/src/__tests__/migration-367-harness-commander-phase1.test.js`
- Create: `packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js`

- [ ] **Step 1: Write the static migration Red test**

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../migrations/367_harness_commander_phase1.sql', import.meta.url),
  'utf8',
);

describe('migration 367 Harness Commander Phase 1', () => {
  it('adds opt-in mode, isolated state, immutable events and actor delivery state', () => {
    expect(sql).toContain('commander_mode');
    for (const table of [
      'harness_commander_state',
      'harness_run_events',
      'harness_actor_messages',
      'harness_actor_deliveries',
      'harness_actor_cursors',
    ]) expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(sql).toContain('append_harness_run_event');
    expect(sql).toContain('harness_attempt_event_version');
    expect(sql).toContain('harness_initiative_run_event_version');
    expect(sql).toMatch(/VALUES\s*\(\s*'367'/);
  });
});
```

- [ ] **Step 2: Run the static test and verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/migration-367-harness-commander-phase1.test.js
```

Expected: FAIL because `367_harness_commander_phase1.sql` does not exist.

- [ ] **Step 3: Add the migration**

The migration must use these exact data boundaries:

```sql
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS commander_mode TEXT NOT NULL DEFAULT 'kernel-only'
  CHECK (commander_mode IN ('legacy-session','kernel-only','hybrid')),
  ADD COLUMN IF NOT EXISTS commander_event_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS event_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS harness_commander_state (
  run_id UUID PRIMARY KEY REFERENCES initiative_runs(id) ON DELETE CASCADE,
  commander_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  provider TEXT,
  account_id TEXT,
  model TEXT,
  provider_session_id TEXT,
  event_cursor BIGINT NOT NULL DEFAULT 0 CHECK (event_cursor >= 0),
  strategy_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_guidance JSONB,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','ready','running','paused','failed','completed')),
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  message_token_count INTEGER NOT NULL DEFAULT 0 CHECK (message_token_count >= 0),
  message_budget INTEGER NOT NULL DEFAULT 256 CHECK (message_budget > 0),
  message_token_budget INTEGER NOT NULL DEFAULT 100000 CHECK (message_token_budget > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS harness_run_events (
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  cursor BIGINT NOT NULL CHECK (cursor > 0),
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version BIGINT NOT NULL CHECK (source_version >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, cursor),
  UNIQUE (run_id, source_type, source_id, source_version)
);

CREATE TABLE IF NOT EXISTS harness_actor_messages (
  message_cursor BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  thread_id UUID NOT NULL,
  correlation_id TEXT NOT NULL,
  source_attempt_id UUID REFERENCES harness_attempts(id),
  event_cursor BIGINT NOT NULL CHECK (event_cursor >= 0),
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT NOT NULL,
  token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS harness_actor_deliveries (
  message_id UUID PRIMARY KEY REFERENCES harness_actor_messages(message_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','delivered','acked','rejected')),
  rejection_code TEXT,
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS harness_actor_cursors (
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  last_message_cursor BIGINT NOT NULL DEFAULT 0 CHECK (last_message_cursor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, actor_key)
);
```

Add `append_harness_run_event(run_id,event_type,source_type,source_id,source_version,payload,occurred_at)` as a `SECURITY INVOKER` PL/pgSQL function. It must take `pg_advisory_xact_lock(hashtextextended(run_id::text, 0))`, return the existing cursor on source replay, allocate `MAX(cursor)+1` for that Run, and never update an existing event.

Add a `BEFORE UPDATE` trigger that increments `harness_attempts.event_version`. Add an `AFTER INSERT OR UPDATE` Attempt trigger that emits only:

- `attempt.starting` when status becomes `starting`;
- `attempt.running` when status becomes `running`;
- `attempt.heartbeat` when `heartbeat_at` advances without another status event;
- `attempt.completed` for `completed` or `completed_with_concerns`;
- `attempt.failed` for `needs_context`, `blocked`, `failed`, or `cancelled`;
- `attempt.expired` instead of `attempt.failed` when `error_code='attempt_lease_expired'`.

The trigger payload whitelist is `attempt_id`, `hop`, `phase`, `role`, `provider`, `account_id`, `requested_machine_id`, `actual_machine_id`, `status`, `failure_class`, and `error_code`. It must not copy `task_bundle`, `result`, callback hashes, credentials, Prompt text, or error messages.

Add a `BEFORE UPDATE` trigger that increments
`initiative_runs.commander_event_version` only when `phase`, `commander_mode`,
`failure_reason`, or `completed_at` changes. Add an `AFTER INSERT OR UPDATE`
Run trigger that emits:

- `run.created` after insert;
- `run.paused` when phase changes to `paused`;
- `run.failed` when phase changes to `failed`;
- `run.completed` when phase changes to `done`;
- `run.phase_changed` for every other phase change.

Its payload whitelist is `phase`, `commander_mode`, `failure_reason`, and
`completed_at`; it must not copy task content or Run memory.

Add an `AFTER INSERT` decision trigger that emits `run.phase_changed` only when the inserted `derived_phase` differs from the previous hop. Use `source_type='orchestrator_decision'`, `source_id=hop::text`, and `source_version=hop`.

- [ ] **Step 4: Write the real PostgreSQL integration test**

Create an isolated schema, apply the real migrations through 367, and assert:

```js
expect(await runMigrations(migrationPool)).toContain('367');
await migrationPool.query(
  `INSERT INTO initiative_runs (id, commander_mode) VALUES ($1,'hybrid')`,
  [runId],
);
await migrationPool.query(
  `INSERT INTO harness_attempts
     (id,run_id,hop,phase,role,provider,task_bundle,callback_secret_hash)
   VALUES ($1,$2,1,'planning','planner','codex','{}','hash')`,
  [attemptId, runId],
);
await migrationPool.query(
  `UPDATE harness_attempts SET status='starting', updated_at=NOW() WHERE id=$1`,
  [attemptId],
);
const events = await migrationPool.query(
  `SELECT cursor,event_type,payload FROM harness_run_events WHERE run_id=$1 ORDER BY cursor`,
  [runId],
);
expect(events.rows).toMatchObject([
  { cursor: '1', event_type: 'run.created' },
  { cursor: '2', event_type: 'attempt.starting' },
]);
expect(JSON.stringify(events.rows)).not.toMatch(/task_bundle|callback_secret|auth|token/i);
```

Also prove a repeated `append_harness_run_event` source tuple returns one cursor and one row, two Runs both start at cursor 1, and a second migration run applies nothing.

- [ ] **Step 5: Run Green and commit Task 1**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-367-harness-commander-phase1.test.js \
  src/__tests__/integration/harness-commander-phase1.integration.test.js
git add migrations/367_harness_commander_phase1.sql \
  src/__tests__/migration-367-harness-commander-phase1.test.js \
  src/__tests__/integration/harness-commander-phase1.integration.test.js
git commit -m "feat(harness): add Commander Phase 1 persistence"
```

### Task 2: Define strict provider-neutral Commander and Actor contracts

**Files:**

- Create: `packages/brain/src/orchestrator/commander-contract.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-contract.test.js`

- [ ] **Step 1: Write contract Red tests**

Tests must import the missing module and prove:

```js
expect(parseCommanderMode('hybrid')).toBe('hybrid');
expect(() => parseCommanderMode('auto')).toThrow();
expect(parseCommanderDirective(validDirective)).toMatchObject({
  schema: 'commander-directive/v1',
  action: 'retry_attempt',
});
expect(() => parseCommanderDirective({
  ...validDirective,
  action: 'merge_pr',
})).toThrow();
expect(() => parseActorMessage({
  ...validMessage,
  payload: { access_token: 'secret' },
})).toThrow('secret_material_forbidden');
```

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/commander-contract.test.js
```

Expected: FAIL because `commander-contract.js` does not exist.

- [ ] **Step 2: Implement exact enums and strict Zod schemas**

Export these frozen values:

```js
export const COMMANDER_MODES = Object.freeze([
  'legacy-session', 'kernel-only', 'hybrid',
]);
export const COMMANDER_ACTIONS = Object.freeze([
  'continue_default',
  'dispatch_role',
  'retry_attempt',
  'revise_guidance',
  'switch_provider',
  'switch_machine',
  'pause_run',
  'request_human',
  'abort_run',
]);
export const ACTOR_KEYS = Object.freeze([
  'commander', 'planner', 'proposer', 'reviewer',
  'generator', 'evaluator', 'judge',
]);
export const ACTOR_MESSAGE_TYPES = Object.freeze([
  'instruction', 'question', 'answer', 'review_feedback',
  'evidence_request', 'escalation',
]);
```

Export `parseCommanderMode`, `parseCommanderBundle`, `parseCommanderDirective`, and `parseActorMessage`. Schemas must be `.strict()` at their top level, use UUIDs for Run/Attempt/message/thread IDs, require an exact `event_cursor`, bound free text to 4,000 characters, bound arrays to 128 items, and recursively reject object keys matching `/token|secret|password|api[_-]?key|auth(?:entication|orization)?|credential_payload/i`.

`CommanderDirective.route` is optional but strict and may contain only `machine`, `provider`, `account`, and `model`. It cannot contain a cwd, account home, credential, CLI command, or session ID.

- [ ] **Step 3: Run Green and commit Task 2**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/commander-contract.test.js
git add src/orchestrator/commander-contract.js \
  src/orchestrator/__tests__/commander-contract.test.js
git commit -m "feat(harness): define provider-neutral Commander contracts"
```

### Task 3: Add isolated Commander state and idempotent Run event stores

**Files:**

- Create: `packages/brain/src/orchestrator/commander-store.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-store.test.js`
- Create: `packages/brain/src/orchestrator/run-event-store.js`
- Create: `packages/brain/src/orchestrator/__tests__/run-event-store.test.js`

- [ ] **Step 1: Write store Red tests**

Cover:

```js
await expect(store.ensureRun({
  runId,
  messageBudget: 64,
  messageTokenBudget: 20000,
})).resolves.toMatchObject({ run_id: runId, event_cursor: 0 });
await expect(store.advanceCursor(runId, {
  expectedCursor: 7,
  nextCursor: 9,
})).resolves.toMatchObject({ event_cursor: 9 });
await expect(store.advanceCursor(runId, {
  expectedCursor: 7,
  nextCursor: 10,
})).resolves.toBeNull();
await expect(events.append({
  runId,
  eventType: 'commander.directive_rejected',
  sourceType: 'commander_directive',
  sourceId: directiveId,
  sourceVersion: 0,
  payload: { reason_code: 'stale_event_cursor' },
})).resolves.toMatchObject({ cursor: 1 });
```

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/run-event-store.test.js
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 2: Implement the stores**

`createCommanderStore(pool)` must export:

```js
{
  ensureRun({ runId, messageBudget, messageTokenBudget }),
  get(runId),
  updateMemory(runId, {
    expectedCursor,
    provider,
    accountId,
    model,
    providerSessionId,
    strategySummary,
    activeRisks,
    latestGuidance,
    status,
  }),
  advanceCursor(runId, { expectedCursor, nextCursor }),
}
```

All writes use `WHERE event_cursor=$expectedCursor`; `advanceCursor` additionally requires `nextCursor >= expectedCursor`. JSON values must pass the secret-key scanner from Task 2 before persistence.

`createRunEventStore(pool)` must export:

```js
{
  append({ runId, eventType, sourceType, sourceId, sourceVersion, payload, occurredAt }),
  list(runId, { afterCursor = 0, limit = 100 }),
  latestCursor(runId),
  assertEvidenceRefs(runId, evidenceRefs),
}
```

`append` calls only `append_harness_run_event(...)`. `list` caps `limit` to 200 and always orders by cursor ascending. Evidence refs accept only `event:<cursor>` and `attempt:<uuid>` and must prove ownership in the current Run.

- [ ] **Step 3: Run Green and commit Task 3**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/run-event-store.test.js
git add src/orchestrator/commander-store.js \
  src/orchestrator/run-event-store.js \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/run-event-store.test.js
git commit -m "feat(harness): persist isolated Commander state and events"
```

### Task 4: Implement the immutable Harness Actor Inbox

**Files:**

- Create: `packages/brain/src/orchestrator/actor-inbox.js`
- Create: `packages/brain/src/orchestrator/__tests__/actor-inbox.test.js`

- [ ] **Step 1: Write Actor Inbox Red tests**

Prove:

```js
const first = await inbox.send(validMessage);
const replay = await inbox.send(validMessage);
expect(replay.message_id).toBe(first.message_id);
expect(await inbox.list({
  runId,
  actorKey: 'planner',
  afterCursor: 0,
  limit: 100,
})).toHaveLength(1);
await inbox.markDelivered({ runId, actorKey: 'planner', messageId: first.message_id });
await inbox.ack({ runId, actorKey: 'planner', messageId: first.message_id });
expect(await inbox.getCursor(runId, 'planner')).toBe(first.message_cursor);
```

Also cover:

- source Attempt belongs to the same Run and sender role;
- evidence refs belong to the same Run;
- sender and recipient differ;
- the 65th message is rejected when `message_budget=64`;
- token budget is checked before insert;
- a new `createActorInbox(pool)` instance resumes the same actor cursor;
- a message cannot write a side-effect action, route, CLI command, cwd, or credential into payload;
- Capture Inbox tables are never queried.

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/actor-inbox.test.js
```

Expected: FAIL because `actor-inbox.js` does not exist.

- [ ] **Step 2: Implement transaction-fenced send, delivery, rejection, and ack**

Export:

```js
createActorInbox(pool, { estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 4) })
```

with methods `send(message)`, `list({ runId, actorKey, afterCursor, limit })`,
`markDelivered({ runId, actorKey, messageId })`,
`reject({ runId, actorKey, messageId, rejectionCode })`,
`ack({ runId, actorKey, messageId })`, and `getCursor(runId, actorKey)`.

`send` must `BEGIN`, lock `harness_commander_state FOR UPDATE`, validate budget, validate the source Attempt and evidence refs, insert message with `ON CONFLICT (run_id,dedupe_key) DO NOTHING`, insert one delivery row, increment budgets only for the winning insert, append `actor_message.accepted`, and `COMMIT`. Any error must `ROLLBACK`.

`markDelivered` must append `actor_message.delivered`. `ack` must lock the
delivery, require the addressed `actor_key`, update status to `acked`, upsert
`harness_actor_cursors.last_message_cursor=GREATEST(...)`, and append
`actor_message.acked` in the same transaction. `reject` emits
`actor_message.rejected` and leaves the immutable message unchanged.

- [ ] **Step 3: Run Green and commit Task 4**

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/actor-inbox.test.js
git add src/orchestrator/actor-inbox.js \
  src/orchestrator/__tests__/actor-inbox.test.js
git commit -m "feat(harness): add persistent Actor Inbox"
```

### Task 5: Build Run-isolated CommanderBundle and deterministic Directive validation

**Files:**

- Create: `packages/brain/src/orchestrator/commander-bundle.js`
- Create: `packages/brain/src/orchestrator/__tests__/commander-bundle.test.js`
- Create: `packages/brain/src/orchestrator/directive-validator.js`
- Create: `packages/brain/src/orchestrator/__tests__/directive-validator.test.js`

- [ ] **Step 1: Write Bundle and validator Red tests**

Bundle tests must prove Run A data never enters Run B and only events after the stored cursor are included:

```js
const bundle = buildCommanderBundle(fixture);
expect(bundle.run_id).toBe(runA);
expect(bundle.new_events.map((event) => event.cursor)).toEqual([8, 9]);
expect(JSON.stringify(bundle)).not.toContain(runB);
expect(() => buildCommanderBundle({
  ...fixture,
  newEvents: [{ ...fixture.newEvents[0], run_id: runB }],
})).toThrow('commander_bundle_run_mismatch');
```

Validator tests must cover every rejection code:

```js
[
  'run_id_mismatch',
  'stale_event_cursor',
  'action_not_allowed',
  'invalid_phase',
  'duplicate_hop',
  'hop_budget_exceeded',
  'cost_budget_exceeded',
  'deadline_exceeded',
  'strict_affinity_violation',
  'capability_not_allowed',
  'evidence_not_owned',
]
```

It must accept one valid `continue_default` and one valid strict-affinity `dispatch_role`, and it must never execute or mutate anything.

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-bundle.test.js \
  src/orchestrator/__tests__/directive-validator.test.js
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 2: Implement the pure Bundle builder**

Export:

```js
buildCommanderBundle({
  runId,
  commanderAttemptId,
  state,
  runProfile,
  objective,
  observed,
  historySummary,
  newEvents,
  actorMessages,
  activeRisks,
  budgets,
  allowedActions,
})
```

It must filter nothing silently: any mismatched Run ID, event cursor `<= state.event_cursor`, non-monotonic event sequence, mismatched Actor message, or secret key throws. The returned object must pass `parseCommanderBundle`.

- [ ] **Step 3: Implement the pure Directive validator**

Export:

```js
validateCommanderDirective(directive, {
  runId,
  eventCursor,
  phase,
  allowedActions,
  nextHop,
  duplicateHop,
  spentUsd,
  maxUsd,
  deadlineAt,
  now,
  strictMachine,
  capabilityAllowed,
  evidenceOwned,
})
```

Return exactly:

```js
{ accepted: true, reason_code: null, directive }
```

or:

```js
{ accepted: false, reason_code: 'stale_event_cursor', directive: null }
```

Validation order is identity → cursor → action/phase → duplicate/hop budget → cost/deadline → strict machine → capability → evidence. No branch may query DB, call a Provider, dispatch an Attempt, merge, or mutate input.

- [ ] **Step 4: Run Green and commit Task 5**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/commander-bundle.test.js \
  src/orchestrator/__tests__/directive-validator.test.js
git add src/orchestrator/commander-bundle.js \
  src/orchestrator/directive-validator.js \
  src/orchestrator/__tests__/commander-bundle.test.js \
  src/orchestrator/__tests__/directive-validator.test.js
git commit -m "feat(harness): validate Commander bundles and directives"
```

### Task 6: Project authoritative Kernel decisions and Attempt lifecycle transactionally

**Files:**

- Modify: `packages/brain/src/orchestrator/decision-log.js`
- Modify: `packages/brain/src/orchestrator/__tests__/decision-log.test.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Modify: `packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js`

- [ ] **Step 1: Write projection Red tests**

The application stores must remain one-statement writes:

```js
expect(pool.query).toHaveBeenCalledTimes(1);
expect(pool.query.mock.calls[0][0]).not.toMatch(/INSERT INTO harness_run_events/i);
```

The real integration test must prove the database trigger creates:

```js
expect(eventTypes).toEqual([
  'run.created',
  'run.phase_changed',
  'attempt.starting',
  'attempt.running',
  'attempt.heartbeat',
  'attempt.completed',
]);
```

and that a transaction rollback leaves neither authority nor projection rows.

Run the focused tests. Expected Red: migration triggers are not yet exercised by the authoritative store path, or event ordering/payload fails the assertions.

- [ ] **Step 2: Keep authority writes single-statement and make trigger assumptions explicit**

Do not append events from JavaScript after `appendHop` or Attempt writes. Add comments and test assertions that the migration trigger is the only lifecycle projector. Ensure every Attempt update continues to set `updated_at=NOW()` so the `event_version` trigger advances. Do not include `result`, `error_message`, or `task_bundle` in any projection.

- [ ] **Step 3: Run Green and commit Task 6**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/decision-log.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/__tests__/integration/harness-commander-phase1.integration.test.js
git add src/orchestrator/decision-log.js \
  src/orchestrator/attempt-store.js \
  src/orchestrator/__tests__/decision-log.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/__tests__/integration/harness-commander-phase1.integration.test.js
git commit -m "test(harness): lock transactional Commander projections"
```

### Task 7: Add read-only Commander observability endpoints

**Files:**

- Create: `packages/brain/src/routes/harness-commander.js`
- Create: `packages/brain/src/routes/__tests__/harness-commander.test.js`
- Modify: `packages/brain/server.js`

- [ ] **Step 1: Write route Red tests**

Using an injected pool/router factory, cover:

```text
GET /runs/:runId/commander
GET /runs/:runId/events?after=0&limit=100
GET /runs/:runId/actors/:actorKey/inbox?after=0&limit=100
```

Assert UUID/actor/limit validation, 404 for missing Run, ascending cursor order, and response field whitelists. Assert no endpoint returns `provider_session_id`, `task_bundle`, `result`, callback hashes, error messages, credentials, or raw Prompt content.

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-commander.test.js
```

Expected: FAIL because the router does not exist.

- [ ] **Step 2: Implement and mount the router**

Export `createHarnessCommanderRouter({ pool })` plus the default production router. Mount it before the existing generic Harness routes:

```js
app.use('/api/brain/harness', harnessCommanderRouter);
app.use('/api/brain/harness', harnessRoutesRouter);
app.use('/api/brain/harness', harnessRoutes);
```

The Commander response whitelist is:

```js
{
  run_id,
  commander_id,
  commander_mode,
  provider,
  account_id,
  model,
  event_cursor,
  strategy_summary,
  active_risks,
  latest_guidance,
  status,
  message_count,
  message_token_count,
  updated_at,
}
```

- [ ] **Step 3: Run Green and commit Task 7**

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-commander.test.js
git add server.js src/routes/harness-commander.js \
  src/routes/__tests__/harness-commander.test.js
git commit -m "feat(harness): expose Commander Phase 1 observability"
```

### Task 8: Version, verify, self-review, and publish the independent Phase 1 PR

**Files:**

- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`

- [ ] **Step 1: Bump the Brain patch version exactly once**

After rebasing on the then-current `origin/main`, bump `1.267.97` to `1.267.98` and synchronize all version files. If another Brain version merged first, rebase and use exactly the next unused patch instead of reusing `1.267.98`. Document:

- `commander_mode` defaults to `kernel-only`;
- Phase 1 stores and validates only;
- event tables are rebuildable projections, not process truth;
- Actor messages cannot cause side effects;
- rollback target is the immediately previous Brain version;
- Phase 2 Provider calls and Phase 5 deployment/canary remain pending.

- [ ] **Step 2: Run the focused Phase 1 suite**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/migration-367-harness-commander-phase1.test.js \
  src/__tests__/integration/harness-commander-phase1.integration.test.js \
  src/orchestrator/__tests__/commander-contract.test.js \
  src/orchestrator/__tests__/commander-store.test.js \
  src/orchestrator/__tests__/run-event-store.test.js \
  src/orchestrator/__tests__/actor-inbox.test.js \
  src/orchestrator/__tests__/commander-bundle.test.js \
  src/orchestrator/__tests__/directive-validator.test.js \
  src/orchestrator/__tests__/decision-log.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/routes/__tests__/harness-commander.test.js
```

Expected: all listed files pass with zero failed tests.

- [ ] **Step 3: Run repository gates**

```bash
cd ../..
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash scripts/ci/check-branch-naming.sh "$(git branch --show-current)"
git diff --check origin/main...HEAD
```

- [ ] **Step 4: Run the relevant Brain regression tier**

```bash
bash scripts/ci/run-core-regression.sh --tier pr
```

- [ ] **Step 5: Self-review against the PRD**

Verify line by line:

- Run A/B state, events, messages, and cursors cannot cross;
- stale cursor, illegal action, duplicate hop, budget, deadline, capability, evidence, and strict affinity all reject with bounded codes;
- original Actor messages are immutable and delivery state is separate;
- Capture Inbox is not imported or queried;
- no secret material is persisted or returned;
- no LLM, Provider, dispatch, merge, deployment, or Xian credential side effect was introduced;
- `derive.js` remains Provider-neutral and does not consume Commander Memory.

- [ ] **Step 6: Commit, push, open, and merge the Phase 1 PR**

Use a compliant `cp-<timestamp>-commander-phase1` branch, open a draft PR, inspect the complete diff, mark ready, wait for required CI, address actionable failures, and squash-merge without `--admin`. Only after merge may Phase 2 planning begin.
