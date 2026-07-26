# Kernel Capability Gate Production Wiring Design

## Context

PR #4342 already contains the capability-gate algorithm, the verified
provider/account/machine matrix, and dispatcher tests that inject a gate. The
production `buildRealDeps()` composition does not create that gate, however, so
the production dispatcher never executes it. The injected tests also do not
prove that an account fallback is used by the persisted attempt and launcher.

The Kernel orchestrator is a child process of the Brain container. Fleet and
LLM-capacity state are owned by the long-running Brain process, while the child
process has its own empty module caches. Production preflight must therefore
consume the Brain-owned state instead of starting a second fleet or capacity
poller.

## Decision

Ship a local-controller production closure in this PR:

1. Add a focused production-probe adapter. It reads machine health/capacity and
   provider account availability from the Brain's existing JSON endpoints,
   verifies GitHub with the resolved token, verifies PostgreSQL with the
   orchestrator pool, and verifies static model capabilities through the
   provider registry.
2. `buildRealDeps()` creates the real capability gate unless a test explicitly
   supplies one, and passes it to the real dispatcher.
3. Capability requirements are normalized by a server-owned role policy.
   Every external worker requires provider authentication and
   `structured_output`; generator and evaluator also require GitHub. A frozen
   structured `contract_requirements`/`capability_requirements` object may only
   add requirements, never turn off the role baseline. PostgreSQL remains an
   explicit contract requirement because not every sprint needs a database.
4. A successful account fallback changes the actual adapter/account-home,
   persisted `account_id`, capability evidence, and launcher input. Evidence
   alone is not a route.
5. A preflight rejection returns `BLOCKED`, writes structured dispatch evidence,
   emits an alert, creates no attempt, and is handled by the Kernel's existing
   no-unchanged-state convergence fence. It must never be reported as a
   successful `DONE_WITH_CONCERNS` launch.
6. The production compose definition declares the controller identity
   `us-mac-m4` and mounts the declared Codex team1-team5 and Grok credential
   homes read-only into Brain. Credentials are never copied into evidence.
7. The current launcher is local Docker. This change does not claim remote
   launch support. A target on another machine remains unavailable until a
   machine-aware launcher/transport exists; the existing pure routing matrix is
   retained for the later commander/transport phase.

## Rejected Alternatives

### Import-only wiring

Passing `createCapabilityGate()` without real probes would replace one test
double with another and could either throw at runtime or mark every capability
as healthy. It does not prove the production call chain.

### Child-process-owned fleet and quota polling

Importing `fleet-resource-cache.js` or starting a second
`getLlmCapacitySnapshot()` poller in the orchestrator duplicates SSH and
external usage calls and starts from cold state after every watchdog restart.
Brain remains the single owner of this data.

### Full cross-machine launch in this PR

The current launcher only calls the local Docker daemon. Returning a remote
machine from routing without a transport would create false evidence. Remote
launch belongs to the provider-neutral commander/transport phase and requires a
separate true-machine fire drill.

## Components

### `preflight/requirements.js`

Exports a pure `deriveCapabilityRequirements({ role, payload })`. It combines
the immutable role baseline with a structured requirements object. Boolean
requirements are OR-merged and model capabilities are de-duplicated.

### `preflight/production-probes.js`

Exports `createProductionCapabilityProbes(deps)`. Network and database effects
are injected at the outer edge for tests:

- `fetchJson('/api/brain/capacity-budget')` supplies canonical Fleet state.
- `fetchJson('/api/brain/dispatch/llm-capacity')` supplies account availability.
- `resolveGitHubToken()` plus `fetch('https://api.github.com/user')` validates
  GitHub without returning the token.
- `pool.query('SELECT 1 AS ok')` validates PostgreSQL.
- `registry.get(provider).capabilities` validates static adapter capabilities.

The adapter returns only bounded, redacted facts. It uses short per-request
timeouts and a one-second cache for the two Brain-owned snapshots.

### `run.js`

`buildRealDeps()` composes production probes, `createCapabilityGate()`, and the
dispatcher. Tests may replace outer I/O, but the production-chain regression
must not inject `dispatch` or `preflightGate`.

### `dispatcher.js`

The dispatcher derives requirements before preflight. After a successful
preflight it re-resolves the adapter and account home from `to_target`, persists
the selected account/machine, and launches with that selected target. A rejected
preflight returns `BLOCKED` with structured evidence.

## Error Handling

- Missing/unknown controller identity: fail closed before attempt creation.
- Brain state endpoint timeout or malformed response: fail closed with a
  bounded probe signature.
- Provider account unavailable: try the deterministic same-provider account
  order already owned by the gate.
- GitHub or PostgreSQL unavailable when required: fail closed.
- Static model capability missing: classify as
  `contract_capability_mismatch`.
- Tokens, cookies, and passwords never appear in probe results or logs. The
  generic evidence redactor also covers suffixes such as `access_token` and
  `refresh_token`.
- A blocked result is not a successful dispatch. It enters the existing
  structured blocked-state convergence path and alerts an operator.

## Verification

The implementation is accepted only with these Red-to-Green proofs:

1. `buildRealDeps → production probes → capability gate → dispatcher →
   createAttempt → launcher`, without injecting `dispatch` or `preflightGate`.
2. team4 unavailable and team1 healthy persists and launches team1, including
   the team1 account home.
3. Role baseline requirements cannot be disabled by payload `false`.
4. PostgreSQL failure creates zero attempts and returns structured `BLOCKED`.
5. Missing controller identity creates zero attempts.
6. Compose exposes the canonical controller identity and all declared local
   credential homes.
7. Existing contract tests, Brain unit/integration tests, version sync,
   DevGate, and GitHub check rollup remain green.

Production deployment is a separate final gate: after merge, rebuild/redeploy
Brain, confirm `CECELIA_MACHINE_ID=us-mac-m4`, confirm the capacity endpoint can
see team1-team5, and run one mixed-provider Kernel fire drill. Until that
fire-drill evidence exists, the seam is `logic-done-pending`, not production
done.
