# Kernel Review Class and Head Advance Design

Date: 2026-07-24  
Scope: PR #4226 third independent-review rework

## Goal

Close the remaining merge-approval bypass and false no-progress terminals without
weakening the server-verified convergence model.

## 1. Human-review classes

`effect:human_review_requested.detail.review_reason` remains the source of truth.
The approval route resolves the referenced request row and derives one of:

- `merge_gate`: `awaiting_human_review`
- `evidence_repair`: `evidence_invalid:repeated_signature` or
  `unknown:missing_failure_signature`
- `convergence`: `failure_set_repeated` or
  `failure_set_patience_exhausted`
- `diagnostic`: all other reasons, including `unknown:*` and `needs_context:*`

The server writes `review_class` into `verdict:human_review.detail`; clients do
not supply it. Ground-truth materialization accepts an approval for the merge
gate only when all of these hold:

1. the decision is approved;
2. its SHA equals the current GitHub head;
3. `review_class` is `merge_gate`;
4. `review_request_hop` points to a merge-gate request for the same SHA.

Evidence, convergence, and diagnostic approvals can affect their own replay
state but can never satisfy `reviewApproved`.

An approval for an unsigned repeated evidence failure unlocks exactly one
evidence-repair attempt. If that attempt returns another unsigned
`evidence_invalid` verdict, the run fails instead of requesting approval again.

## 2. Head advance during callback verification

The GitHub-resolved current head is authoritative. For a generator-fix intent
with trigger SHA `A`:

- claimed SHA is invalid syntax: terminal `callback_sha_invalid`;
- resolver confirms current head is the claimed SHA: verified callback;
- resolver confirms current head is still `A` while claim differs: terminal
  `callback_sha_unverified`;
- resolver confirms current head advanced to `C != A`: record
  `verification_pending`; replay treats verified current head `C` as the new
  progress point even if the callback claimed an intermediate SHA;
- resolver throws or the run has no `pr_url`: record
  `verification_pending` and retry through replay;
- replay can verify a pending claim when it later equals current head; if the
  current head moved beyond the trigger, replay follows the current head.

This preserves fake-SHA rejection when the branch did not move while allowing
`gh pr update-branch` and human pushes to start a new observation round.

## 3. Watchdog deadline pause

The watchdog no longer exempts a run merely because a request row contains a
non-empty SHA. It selects overdue candidates, identifies the latest undecided
request with no later decision-log row, resolves the run's current PR head, and
pauses cleanup only when the request SHA equals that head.

Resolver failures are retried on the next watchdog pass rather than converted
to a false terminal. A missing PR URL or a confirmed SHA mismatch does not
pause cleanup.

## 4. Verification

Each group lands as a separate Red then Green pair:

1. merge-gate class separation plus unsigned evidence one-shot approval;
2. head-advance replay plus missing-`pr_url` pending callback;
3. watchdog current-head reconciliation.

The final verification includes the focused files, relay permanent pool, the
controlled Brain pool, true PostgreSQL kernel wiring, static gates, and GitHub
check rollup. PR #4226 remains unmerged.
