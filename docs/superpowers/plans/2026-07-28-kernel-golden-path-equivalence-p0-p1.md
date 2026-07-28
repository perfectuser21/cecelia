# Kernel Golden Path P0/P1 Equivalence Plan

> Execution rule: each phase is an independent Draft PR with Red/Green commits,
> independent specification and security review, CI, Evaluator, Judge, and the
> applicable human gate. No phase may rely on a later phase to make its own
> unsafe behavior acceptable.

## Goal

Prove that the unified Kernel platform preserves or strengthens every P0/P1
safety and quality behavior that was previously implemented by Claude Code
hooks, `/dev`, the one-session harness, CI, deployment workflows, and manual
operations.

The proof unit is not a copied hook. It is a versioned behavior contract with:

1. an old-platform evidence reference;
2. one server-owned Kernel construct;
3. positive, negative, adversarial, and proven-to-fire tests;
4. a SHA/version-bound effect receipt;
5. explicit failure, timeout, and freshness semantics.

## Controller model

- There is one shared deterministic Kernel Run Controller implementation.
- Each `run_id` has one logical controller instance and durable state.
- Planner, Proposer, Reviewer, Generator, Evaluator, Judge, and Reporter are
  Attempts, not independent workflow owners.
- Fleet Supervisor owns machine admission and capacity. It cannot approve a
  merge or production release.
- GitHub Actions supplies observations and effects. It cannot infer Kernel
  ownership from a title or branch name.
- A run is complete only after the production effect receipt and report ledger
  have been durably accepted.

## Canonical state machine

```text
task_born
→ intent_approved
→ planned
→ contract_approved
→ generated
→ ci_passed
→ evaluated
→ judged
→ human_reviewed | auto_review_eligible
→ merge_authorized
→ merged
→ staging_queued
→ staging_running
→ staging_passed
→ production_deploying
→ production_verified
→ reported
→ done
```

Every transition is bound to `task_id`, `run_id`, PR number, and exact head or
merge SHA. `failed`, `blocked`, `cancelled`, `skipped`, `unknown`, stale SHA,
and timeout are different states and never count as `passed`.

## Phase 0 — Close every merge bypass

### Server-owned PR ownership

Add an immutable Kernel PR ownership record containing at least:

- task/run/generator Attempt identity;
- repository and PR number;
- head ref and current head SHA;
- review policy and policy version;
- ownership state and freshness timestamp.

Unknown or conflicting ownership is fail-closed.

### Merge authorization

Only `mergeGate()` may issue a one-time `Kernel Merge Authorized` receipt for
the current head SHA. Evaluator, Judge, and required human approval receipts
must all bind the same SHA.

All other merger paths must query this receipt:

- `.github/workflows/ci.yml` auto-merge;
- `orphan-pr-worker.js`;
- PR shepherd/recovery workers;
- manual or scheduled automation controlled by Cecelia.

A PR title, branch regex, task result string, label, or CI success alone is
never ownership or authorization.

### CI aggregation

`ci-passed` accepts only `success`. A skipped job is acceptable only when a
server-owned path predicate explicitly declares it not applicable. `failure`,
`cancelled`, `timed_out`, `action_required`, `neutral`, `stale`, and unknown
values deny.

### Required adversarial proofs

- a `cp-fleet-*` PR older than two hours cannot be orphan-merged;
- changing the PR title cannot change ownership;
- cancelled CI cannot produce aggregate success;
- missing/stale Evaluator, Judge, or human approval denies every merger;
- a new commit invalidates the prior merge authorization.

## Phase 1 — Unified mutation and credential broker

Provider containers receive no GitHub mutation credential.

They may produce a bounded candidate patch/commit in their Attempt workspace.
The server-owned mutation broker alone may:

- validate repository, branch, base/head SHA, and allowed path scope;
- reject main, arbitrary refs, force/delete pushes, submodule escapes, and
  unexpected repositories;
- scan the final diff and generated logs for credentials and forbidden files;
- create the commit, push only the Attempt-bound branch, and create/update the
  bound PR;
- append an exact mutation receipt.

This replaces Claude-only Branch Guard, Credential Guard, and relevant Stop
Hook behavior with provider-neutral constructs.

## Phase 2 — ReleaseRun

Create a durable ReleaseRun bound to the merge SHA and artifact versions.

Required transitions:

```text
merged
→ staging_queued
→ staging_running
→ staging_passed(merge_sha)
→ production_deploying(merge_sha)
→ production_verified(merge_sha, deployed_versions)
```

Rules:

- low risk does not bypass staging;
- `skipped_*`, `idle`, unknown, and unavailable staging deny production;
- scheduled/manual production workflows cannot select an unapproved latest
  `main`; they consume a ReleaseRun authorization for one SHA;
- staging and production share one release concurrency/lease;
- production verification includes health, version/SHA readback, required E2E,
  and rollback metadata;
- Kernel report/done occurs only after `production_verified`.

## Phase 3 — Post-diff risk and human review

Risk is calculated by the server after the candidate diff and contract are
known. Caller payloads may only increase risk.

Human review is mandatory for:

- first execution of a behavior/capability;
- new feature or changed contract;
- schema/migration, CI/workflow, security, credential, deployment, or core
  orchestration changes;
- unknown ownership, scope, or risk;
- an expired proof or changed head SHA.

Auto-review eligibility requires:

- prior successful production receipt for the same behavior version;
- unchanged contract and allowed path class;
- bounded small diff;
- no protected category;
- all current mechanical evidence passing.

Human approval is bound to task/run/request hop/current SHA and expires on any
change.

## Phase 4 — Explicit Behavior Ledger

Create append-only entries with:

- `behavior_id`, priority, owner, and contract version;
- old evidence and unified construct references;
- applicable Golden Path step and all 11 dimensions;
- test names and last proven commit/version;
- effect receipt identity;
- state: `proven`, `gap`, or `intentional_replacement`;
- freshness deadline and supersession link.

The 11 dimensions are:

1. FR
2. NFR
3. invariant
4. checkpoint
5. freshness
6. death alert
7. failure semantics
8. effect confirmation
9. adversarial surface
10. ledger freshness
11. task/run/PR/SHA/release axis alignment

Notes, smoke status, or calendar age may inform a ledger entry but cannot
manufacture proof.

## Delivery order

1. Result-channel bootstrap: durable provider-neutral evidence and receipts.
2. Merge authority firewall.
3. Mutation/credential broker.
4. ReleaseRun and production receipt.
5. Post-diff human-risk policy.
6. Behavior Ledger backfill and final equivalence report.

The first real run of every phase stops at the owner human gate before merge.
Subsequent auto-review is enabled only by a production receipt and the
server-owned policy above.
