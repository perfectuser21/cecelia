# Kernel Equivalence Production Assembly Plan

> Execute every task with test-driven development. A unit double may prove a
> boundary, but it cannot produce a proof bundle or change a behavior from
> `gap` to `proven`.

## Goal

Make the Brain-owned trusted execution socket assemble all eleven real Kernel
behavior seams from server-owned configuration, execute only against isolated
resources, and retain independently verifiable cleanup and effect evidence.
Keep startup fail-closed until every required production port, public key,
protected private-key reference, and database migration is present.

## Non-negotiable boundaries

- One deterministic controller owns each `run_id`; provider Attempts never
  receive GitHub mutation, merge, release, signer, or database authority.
- `regression-contract.yaml` remains the only 11-behavior/99-cell manifest.
- Private keys and credentials are protected file references, never raw
  environment values, argv, logs, database JSON, or repository content.
- All drills use exact `equivalence-drill/{run_id}/{attempt_id}` resources.
  Main, protected refs, the Cecelia production repository, shared credentials,
  staging shared with a release, and production are forbidden.
- A seam signer signs only an observation produced by its own real seam.
  Isolation, cleanup, runner, and collector cannot sign that observation.
- Violation and recovery execute in order for the same behavior/provider
  boundary; recovery must resolve the committed violation predecessor.
- Timeout, cancellation, unknown cleanup, stale SHA, missing human approval,
  and ambiguous commit settlement fail closed with `late_effect_risk` retained.
- No merge, staging, production deployment, key provisioning, or live drill
  occurs before explicit owner approval.

## Task 1 — Durable isolated-case authority (migration 377)

Create an append-only case ledger keyed by cell/run/attempt/resource and a
mutable lease row guarded by generation plus exact owner. Store only bounded
public case metadata and protected references. The schema must:

- reject duplicate/conflicting case identity and cross-cell resource reuse;
- allow only the canonical eleven seam IDs and three scenarios/providers;
- bind artifact SHA, Brain/Engine versions, resource prefix/ref, and expiry;
- retain prepare/cancel/cleanup transitions and independent inspection facts;
- prohibit UPDATE/DELETE/TRUNCATE on evidence rows;
- expire abandoned leases without deleting evidence;
- use database time and compare-and-swap for every mutable transition.

Provide a PostgreSQL store with AbortSignal, database-side deadlines, stable
error codes, real concurrent integration tests, and no caller-supplied SQL or
resource paths.

## Task 2 — Security isolation and authority ports

Implement the five security ports consumed by the production seam builders:

1. protected-ref guard;
2. credential attempt lease;
3. GitHub mutation broker;
4. merge effect executor;
5. human-review authority.

The isolation allocator provisions only a configured sandbox repository whose
name ends in `-kernel-equivalence-drills`; it rejects the Cecelia repository
and protected refs. GitHub state is queried by exact repo/PR/head SHA. Normal
and recovery may create bounded ephemeral branches/draft PRs; violation must
exercise a real denial without mutating the protected target. Credential cases
use dedicated drill accounts/leases and prove revocation/cleanup. Human-review
normal/recovery require an actual current-head owner approval receipt; code may
never manufacture one.

Cancellation and cleanup remove the exact ephemeral branch/PR/lease only after
identity readback. Unknown or conflicting identity is retained for operator
cleanup and reported unconfirmed.

## Task 3 — Quality isolation and authority ports

Implement the five quality/runtime ports:

1. independent evaluator/judge;
2. orphan liveness recovery;
3. DevGate/TDD/DoD;
4. controller/Attempt ownership;
5. report/learning closure.

Provision isolated PostgreSQL runs/tasks/attempts and temporary Git workspaces
from exact templates. Never target a live task/run/attempt. Server-owned
authority loaders return only the resource bound to the signed grant.
Snapshots query the actual store/workspace. Recovery predecessor bindings are
resolved from committed trusted bundles, not caller JSON. Cleanup removes
temporary workspaces and expires isolated rows while preserving append-only
evidence.

## Task 4 — Effect signer set and protected configuration

Add an exact eleven-entry signer loader. Each entry requires:

- one unique active `effect_receipt` key ID bound to the exact seam;
- one protected owner-only regular private-key file;
- a matching public key/lifecycle record in the root trust registry;
- no symlink, hard link, ACL, group/world access, or raw secret fallback.

Load the collector independently. Snapshot the root contract and canonical
99-cell plan once at boot, compare it to the compiled canonical descriptor
digest, and reject key/plan drift before opening the socket.

## Task 5 — Production `createService`

Create one fail-closed production factory that composes:

- canonical contract/plan and trust registry;
- shared PostgreSQL pool;
- protected grant authority;
- exact production seam builders;
- exact effect signer set;
- security and quality isolation ports;
- independent cleanup inspector;
- trusted runtime and trusted execution service.

`packages/brain/server.js` supplies this factory to
`bootBrainTrustedExecution()`. Missing configuration returns a bounded
readiness code and does not create a listener. Tests must traverse
server boot → socket EOF → protected grant → nonce → real registered adapter →
cleanup verifier → bundle commit without injecting a registry or service at
the inner boundary.

## Task 6 — Release adapter

After the independently reviewed ReleaseRun implementation is integrated, add
the eleventh adapter and signer around its actual staging/promotion seam.
Drills use a dedicated ephemeral staging target and immutable test artifact;
they never select latest `main` or production. Normal proves staging gate and
promotion authorization, violation proves missing/stale authorization denial,
and recovery proves a newly authorized exact SHA. Cleanup must not erase the
ReleaseRun receipt chain.

## Task 7 — Adversarial and full regression

Require at least:

- getter/Proxy/config substitution and mutable-receiver rejection;
- alternate 99-cell plan, key-purpose swap, stale/revoked key, nonce replay;
- slowloris, delayed tail, event-loop deadline overrun, COMMIT/abort race;
- cross-run/attempt/resource, stale SHA, wrong repo/ref, and forged predecessor;
- provider credential/log/argv leakage scans;
- partial prepare, cancellation failure, cleanup identity mismatch;
- server restart/replay and concurrent duplicate execution;
- fresh sequential migrations 368 through 377 in real PostgreSQL;
- full Brain, Engine, CJS broker, DevGate, version, lint, syntax, and diff checks.

The root contract remains `0/99` until live execution is explicitly approved.

## Task 8 — Draft PR and proof execution

Open only a Draft PR because repository CI can auto-merge a ready PR. Require
CI, Evaluator, Judge, and owner human review on the exact head SHA. After
explicit owner approval, merge and run staging before any production deploy.
Only after version/SHA readback and production verification may the isolated
99-cell drill coordinator run.

For every cell retain the signed grant, actual seam receipt, cleanup evidence,
collector bundle, PostgreSQL hash-chain identity, and exact artifact/version
axes. Update a behavior to `proven` only when all nine provider/scenario cells
verify fresh. The final report must show 11/11 behaviors and 99/99 cells, with
no blocker, stale proof, or unconfirmed cleanup.
