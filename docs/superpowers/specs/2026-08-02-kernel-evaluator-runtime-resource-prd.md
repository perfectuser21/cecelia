# Kernel Evaluator Runtime Resource Contract PRD

**Status:** implementation approved
**Scope:** close the production `generator -> evaluator -> judge` resource gap without changing the existing Kernel/Commander/Fleet architecture

## 1. Production evidence

The real US M4 canary completed planner, four proposer/reviewer GAN rounds, and
generator. It opened a real business PR whose CI is green. The evaluator then
returned `needs_context/env_missing` because `DB_URL`, two business sessions,
and their tenant identifiers were absent.

This is an infrastructure failure, not a product verdict:

- the dispatcher checks `contract_requirements`, but the TaskBundle and remote
  transport do not carry a bounded runtime-resource request;
- PostgreSQL admission probes the Brain controller pool, not the selected Fleet
  node that will execute the attempt;
- Fleet Worker launches the Runner without provisioning attempt-scoped services;
- the contract allowed pre-injected business cookies although they should be
  created by the test through the product's real signup/login path.

## 2. Outcome

A Kernel attempt that declares `postgres: true` receives a private,
attempt-scoped PostgreSQL service on the selected Fleet node. The Runner gets
an ephemeral database URL; no host port or credential is exposed. Local-API
business tests create temporary users, sessions, and tenants through real
product flows. Evaluator and Judge remain blind and evaluate the exact PR SHA.

## 3. Runtime-resource contract

The server derives a bounded request and places it at
`TaskBundle.inputs.runtime_resources`. The only Phase 1 field is:

```json
{ "postgres": true }
```

Unknown fields, URLs, passwords, cookies, tokens, and caller-supplied secrets
are rejected or discarded. The remote transport forwards only the normalized
boolean request. The request must be absent from both envelopes or present and
equivalent in both; Fleet Worker rejects a single-sided or mismatched request
before provisioning.

## 4. Fleet lifecycle

For each requesting attempt, Fleet Worker must:

1. create a private Docker network;
2. start the pinned multi-architecture PostgreSQL image
   `postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`;
3. generate random per-attempt database credentials in memory;
4. wait for bounded `pg_isready` health;
5. attach the Runner to the same network and inject `DB_URL` and
   `DATABASE_URL`;
6. persist only non-secret resource identifiers needed for reconciliation;
7. remove the service and network on terminal callback, cancellation,
   launch/provision failure, or stale-attempt reconciliation.

No database port is published to the host. Cleanup is idempotent and scoped to
the exact attempt ID. Ownership is the deterministic attempt identity, not the
Worker's current image policy, so upgrades cannot strand older resources.

## 5. Admission and drift

`postgres` admission is a property of the selected Fleet node, not the Brain
controller database. Node health/admission projects whether the pinned image
and Docker runtime can actually start PostgreSQL and reach `pg_isready`, not
merely whether the image is cached. Missing capability, runtime-start failure,
digest drift, or an unreachable Worker fails closed before attempt creation.
The disposable probe uses no host port or external network. Evidence is bounded
and never contains credentials.

## 6. Business authentication

For `local_api` contracts, cookies and tenant IDs are product state rather than
Fleet secrets. Contract proposer must require the E2E to create temporary users
through the real signup/login endpoints, retain its own cookie jars, discover
the resulting tenant IDs, and clean up by destroying the isolated database.
Contract reviewer must reject dependencies on pre-injected `AUTH_COOKIE`,
`TENANT_ID`, or equivalent long-lived business credentials.

The database starts empty by design. Before starting the application, the E2E
must run the repository's real schema/migration bootstrap against `DB_URL` and
prove the required tables exist. Fleet must not embed application-specific
schemas or copy production data into the sidecar.

This rule does not weaken authentication or replace it with mocks.

## 7. Failure semantics

- Resource unavailable before launch: `BLOCKED/resource_unavailable`, zero
  attempt side effects.
- Provisioning or health timeout: attempt infrastructure failure with complete
  rollback; never a product `FAIL`.
- Product signup/login fails after the environment is healthy: evaluator may
  return a product verdict with command evidence.
- Terminal callback cannot complete until the exact leased Worker returns a
  verified, bounded cleanup receipt. Only `cleaned` and `already_clean` may
  commit terminal state; unavailable, failed, incomplete, or quarantined
  cleanup leaves the attempt non-terminal and returns a retryable error. The
  Worker releases runtime resources but keeps the callback-sending Runner alive
  until Brain returns success; full Runner/workspace cleanup follows natural
  Runner exit. Server-side artifact verification runs before resource release.

## 8. Red-to-Green acceptance

1. Dispatcher projects the normalized request into the TaskBundle.
2. Remote transport forwards only `{postgres:true}` and no secret material.
3. PostgreSQL preflight reads the selected Worker's admission projection and
   never queries the Brain pool.
4. Worker creates a private network and pinned sidecar before Runner launch.
5. Runner receives ephemeral URLs; persisted attempt state remains redacted.
6. Provision, launch, terminal, cancel, and reconcile paths all prove exact,
   idempotent cleanup.
7. A local-API contract migrates the empty database and self-creates temporary
   authenticated tenants instead of consuming pre-injected business state.
8. The real US M4 business canary reaches Evaluator PASS and independent Judge
   PASS on the exact final PR SHA, with real database and real signup/login.
9. CI is green and the business PR is not merged before the blind verdict.

## 9. Non-goals

- no Phase 4B/4C/4D work;
- no alternative container runtime;
- no long-lived Codex or business credentials on Xian nodes;
- no synthetic canary and no Phase 5 completion claim;
- no rewrite of Commander, Kernel, or Fleet routing;
- no automatic merge of a SHA that Evaluator and Judge did not inspect.
