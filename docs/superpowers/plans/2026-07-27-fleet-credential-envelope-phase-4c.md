# Fleet Credential Envelope Phase 4C Implementation Plan

> **Execution rule:** Use `superpowers:executing-plans` and
> `superpowers:test-driven-development`. Observe every production behavior fail
> for the intended reason before implementing it.

**Goal:** Make US M4 the only authority for Codex team1-team5 credentials and
deliver exactly one Attempt-bound credential copy to the selected Fleet Worker
without persisting or returning provider secrets.

**Architecture:** Brain adds a narrow Credential Broker at the existing
production transport boundary. For a Codex Attempt, the Broker reads only the
selected US-owned account file, proves that its token lifetime covers the
Attempt deadline plus margin, and issues a versioned envelope bound to
`attempt_id`, `account_id`, and canonical `machine_id`. The authenticated Worker
validates and atomically consumes the envelope before Git or Docker side
effects. The Worker streams the credential through a one-shot FIFO into a
container tmpfs; the Runner creates `0600 CODEX_HOME/auth.json`, reports only
`credential_ref` and `credential_copy_mutated`, and relies on container removal
to destroy the tmpfs. No scheduler, account selector, or second credential
authority is introduced.

**Base:** `origin/main` at Phase 4B merge
`d37a5e578`.

**Out of scope:** deployment, touching live Fleet nodes, copying long-lived
credentials to Xian, refreshing OAuth tokens, changing capability selection,
Phase 4D recovery equivalence, and Phase 5 real-task acceptance.

## Dependency graph

```text
Phase 4B merged
  └─ Brain Credential Broker contract
       ├─ Attempt/account/machine/deadline binding
       └─ one selected US credential → one envelope
            └─ authenticated Worker validation + atomic consumption
                 └─ FIFO → container tmpfs → 0600 auth.json
                      └─ credential_ref/mutation-only callback evidence
                           └─ Phase 4C contract smoke / RCI / version

Phase 4C merge
  └─ Phase 4D execution and recovery equivalence
```

## Frozen envelope contract

The transient launch request may carry:

```json
{
  "contract_version": "credential-envelope/v1",
  "credential_ref": "uuid",
  "attempt_id": "uuid",
  "account_id": "team4",
  "machine_id": "xian-mac-m4",
  "issued_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "payload_hash": "sha256:<64 lowercase hex>",
  "payload": "<base64 of the selected auth.json bytes>"
}
```

Only the seven metadata fields named by the PRD may be persisted. `payload` is
transient Worker-process input and must never enter Attempt state, receipts,
callbacks, logs, argv, environment variables, or ordinary host files.

Codex launch requires an envelope. Claude and Grok launch reject one. A
credential reference is consumed atomically before workspace or Docker side
effects and cannot be reused by another Attempt.

## Phase 4C file boundary

Create:

- `packages/brain/src/orchestrator/credential-broker.js`
- `packages/brain/src/orchestrator/credential-broker.test.js`
- `packages/brain/scripts/fleet-worker/credential-envelope.cjs`
- `packages/brain/scripts/fleet-worker/credential-envelope.test.cjs`
- `packages/brain/scripts/smoke/fleet-credential-envelope-smoke.sh`

Modify:

- `packages/brain/src/orchestrator/run.js`
- `packages/brain/src/orchestrator/__tests__/run.test.js`
- `packages/brain/src/orchestrator/production-transport.js`
- `packages/brain/src/orchestrator/production-transport.test.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.js`
- `packages/brain/src/orchestrator/remote-bridge-transport.test.js`
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- `docker/cecelia-runner/entrypoint.sh`
- the existing Runner entrypoint contract test selected during implementation
- `regression-contract.yaml`
- `docs/registry/features/orchestration.yml`
- `packages/quality/smoke-allowlist.txt`
- `DoD.md`
- `.brain-versions`
- `DEFINITION.md`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- `package-lock.json`

Any additional file is a scope exception and must be justified in the PR body.

## Red oracle

Record these failures before implementation:

1. Broker rejects a non-US controller, non-team account, invalid machine,
   mismatched Attempt, and insufficient credential lifetime.
2. Codex transport fails closed without a Broker; a valid launch serializes
   exactly one selected envelope; Claude/Grok never receive provider secrets.
3. Worker rejects missing, expired, hash-mismatched, Attempt-mismatched,
   machine-mismatched, account-mismatched, or replayed envelopes before Git and
   Docker calls.
4. Atomic consumption metadata contains no auth JSON, access token, refresh
   token, API key, or payload.
5. Docker create uses a Codex tmpfs and one-shot FIFO; secret bytes never appear
   in Docker argv, environment, prompt/runtime files, state, receipt, or logs.
6. Runner creates `CODEX_HOME/auth.json` with mode `0600` before Codex starts.
7. A changed temporary auth copy produces only
   `credential_copy_mutated=true`; callback includes `credential_ref` and no
   credential bytes.
8. Terminal/cancel/start failure removes the FIFO/runtime material and
   container tmpfs; replay remains rejected.
9. Fleet Worker launch has no Xian-local `loadRawAuth` or account allowlist
   fallback.

## Task 1: Freeze the Broker contract

Write `credential-broker.test.js` first. Cover strict identifiers, US-only
authority, regular-file and permission checks, JWT expiry/deadline margin,
single-account reads, immutable metadata, hash generation, and error
redaction. Then implement the pure issuer and production file loader.

## Task 2: Wire Brain launch issuance

Add failing transport and `buildRealDeps` tests. Inject the Broker into the
existing production transport, issue only after the final target/account is
known, and include the envelope only for Codex. Do not put provider auth in
TaskBundle, ProviderSpec, Attempt rows, or launch receipts.

## Task 3: Validate and atomically consume at Worker

Write `credential-envelope.test.cjs` first. Validate the exact schema, binding,
expiry, payload hash and auth JSON shape. Use `open(..., "wx", 0600)` under a
Worker-owned credential-consumption metadata directory for cross-request
one-time use. Persist metadata only.

## Task 4: Join envelope consumption to Attempt launch

Add Attempt Runner and HTTP Red tests proving credential validation and
consumption happen before workspace preparation. Codex requires the envelope;
other providers reject it. State may retain only `credential_ref`,
`account_id`, `machine_id`, timestamps and hash.

## Task 5: Stream into container tmpfs

Add Docker adapter Red tests for `--tmpfs`, a `0600` FIFO, non-secret Docker
arguments/environment and start-failure cleanup. Update the Runner entrypoint
contract to read the FIFO into tmpfs `auth.json`, set `CODEX_HOME`, hash before
and after execution, and remove the FIFO immediately after reading.

## Task 6: Return bounded credential evidence

Add Runner/callback contract tests. Enrich only `provider_metadata` with
`credential_ref` and `credential_copy_mutated`. Confirm full secret strings do
not occur in callback JSON, Worker state, receipt, logs, or thrown errors.

## Task 7: Close fallback and register regression evidence

Add the Phase 4C smoke and P0 regression contract. Its fixtures use fake auth
bytes and a recorded Docker boundary; they are security contract evidence, not
Phase 5 real-task acceptance. Assert Fleet Worker production code does not read
`~/.codex-team*`, call `loadRawAuth`, or consume `CODEX_ACCOUNT_ALLOWLIST`.
Update registry, definitions and Brain version.

## Task 8: Verify and publish the independent PR

Run focused Red/Green suites, shell/Runner contracts, Phase 4B regression,
Phase 4C smoke, registry/version/DevGate checks, `git diff --check`, and the
PR-tier core regression. Commit intentionally, push the Phase 4C branch, open
one PR against `main`, self-review, and follow CI to completion. Do not deploy
or mutate live Fleet nodes.
