# Kernel Post-Diff Risk and Human Review Policy

## Goal

Make the Kernel Controller, rather than a task caller, decide whether a candidate
change may merge automatically after the exact PR diff and approved contract are
known. A caller may request a stricter review level but can never lower the
server-derived level.

## Authority model

The server builds one `kernel-post-diff-risk/v1` proof for the current candidate.
The proof is bound to:

- task ID, run ID and decision hop;
- exact GitHub PR head SHA;
- canonical diff hash computed from sorted paths, rename source, blob SHA,
  patch digest and line counts, plus exact base repository/ref/OID;
- approved contract ID, digest, version and approval timestamp;
- server-derived capability, behavior and path-surface fingerprints;
- the exact trusted required-check run/status identities;
- policy version and proof expiry.

Missing or malformed input never means low risk. Unknown GitHub diff data,
missing contract authority, absent or expired production proof, and conflicting
classification all force human review.

The caller's optional `risk_level` is combined by taking the maximum severity.
It is not accepted as evidence for automatic eligibility.

## Classification

The server classifies paths deterministically. The following classes are always
protected: database migrations, CI and GitHub workflows, security and credential
code, deployment and release code, and core Kernel orchestration. A changed path
that cannot be classified is protected as `unknown`.

Human review is mandatory for:

- a behavior fingerprint with no prior production receipt;
- a new capability;
- contract version or digest drift;
- path-class drift;
- any protected class;
- an unknown or expired proof;
- a diff that exceeds the small-diff bounds.

Automatic eligibility requires every condition below:

- an unexpired, digest-valid production receipt for the same repository and
  behavior fingerprint, issued by the release controller and linked to exact
  ReleaseRun and release-effect receipt UUIDs;
- the same contract digest/version and path class as that receipt;
- at most five files and at most 200 changed lines;
- no protected path class;
- current CI, evaluator and judge evidence all explicitly PASS;
- no caller elevation above low risk.

## Persistence

Migration 373 adds two append-only ledgers:

- `kernel_behavior_production_receipts` records deployed behavior authority;
- `kernel_post_diff_risk_assessments` records the exact proof used by a run.

The risk assessment is persisted alongside the merge authorization evidence.
This phase only defines and consumes production receipts; the release pipeline
is the sole future writer after production confirmation.

Migration 373 intentionally does not pretend that those UUID fields prove a
ReleaseRun. Until a later migration introduces the authoritative append-only
ReleaseRun/effect-receipt tables and an exact repository, merge SHA and artifact
digest join, receipt queries emit `release_authority_valid=false`. Therefore
repeated behavior remains human-review-required; automatic reuse must not be
enabled merely by inserting a self-hashed row into the receipt table.

## Review and merge flow

GroundTruth fetches GitHub `files` with path/addition/deletion data after the PR
exists and loads the approved contract plus matching production receipt. It
computes the proof before `deriveVerdictChain`.

`deriveVerdictChain` uses `effective_review_required` from that proof. The human
review request and approval verdict both carry the exact proof bindings. A new
head, diff, contract digest, policy version, or review-request hop invalidates
the approval.

The merge-effect boundary fetches the current diff again, loads the current
contract and production receipt, recomputes the proof, and requires byte-for-byte
authority-binding parity before issuing the exact-SHA merge effect.

Immediately before the effect, the broker reloads the immutable contract and
ledger evidence and re-observes GitHub base, diff and required checks. The
remote atomic backstop is a mandatory repository contract, not an inference
from a green check: branch protection must be strict/up-to-date, apply the
complete server-owned required-context set, enforce administrators, and disable
force pushes and deletion. The production set is `ci-passed`,
`Harness V5 Gate Passed`, and `Smoke Glob Runner Passed`; the latter is a
commit-status identity, not a check-run identity. If protection evidence is
missing or differs, CI is `pending` and merge is denied. The broker never uses
`--admin`; `--match-head-commit` additionally locks the head at GitHub.

## Test strategy

Pure policy tests cover path classification, caller monotonicity, production
receipt matching, expiry, small-diff bounds, protected classes and unknown data.
GroundTruth tests prove server-side computation. Derive tests prove mandatory
human and automatic paths. Approval-route and merge-authority adversarial tests
prove stale head/diff/contract/policy/hop approvals cannot authorize a merge.
Migration and production wiring tests pin the append-only ledgers and current
GitHub diff fields.
