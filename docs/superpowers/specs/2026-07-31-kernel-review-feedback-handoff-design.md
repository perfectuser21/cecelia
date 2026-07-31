# Kernel Reviewer Feedback Handoff Design

## Problem

Kernel GAN persists a review verdict, but the next Proposer TaskBundle contains no
review feedback. Production evidence from R16 rounds 6 and 7 shows
`task_bundle.inputs.review_feedback` is absent even though the completed Reviewer
attempt contains a useful `summary` and `decision.reason`. The Proposer therefore
re-discovers defects and can repeat them across rounds.

## Decision

Use the completed Reviewer attempt as the feedback SSOT and pass a bounded,
structured projection to the next Proposer:

- `attempt_id`
- `contract_round`
- `contract_sha`
- `summary`
- `reason`

The projection is accepted only when the Reviewer attempt's TaskBundle round and
SHA match the current remote proposal branch. It never includes provider
transcripts, credentials, or private reasoning.

## Data flow

1. `collectGroundTruth` identifies the latest completed Reviewer attempt whose
   round and SHA match the current proposal branch.
2. It exposes the bounded projection as `ganLatestRoundReviewFeedback`.
3. `buildInputs` copies that projection to
   `TaskBundle.inputs.review_feedback` only for `spawn:proposer`.
4. The existing skill receives the field through the canonical TaskBundle; no
   Worker-side Brain query or Git side channel is introduced.

## Failure semantics

- Missing, stale, malformed, round-mismatched, or SHA-mismatched feedback is
  omitted fail-closed.
- A first-round Proposer has no feedback field.
- Reviewer bundles remain fresh/read-only and do not inherit Proposer
  transcripts.

## Alternatives rejected

- Worker queries Brain for the previous attempt: couples execution to a live
  control-plane API and creates another authorization/failure boundary.
- Store full review text in Git: bloats contract branches and makes transient
  execution feedback a repository artifact.

## Verification

- Ground-truth unit test proves only matching Reviewer feedback is projected.
- Dispatcher unit test proves the next Proposer receives the projection and no
  private transcript.
- Existing orchestrator tests, Brain contract tests, DevGate, version and
  `DEFINITION.md` checks remain green.
