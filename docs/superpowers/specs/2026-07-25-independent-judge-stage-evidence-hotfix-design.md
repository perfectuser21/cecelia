# Independent Judge Stage Evidence Hotfix Design

## Problem

R9 run `e9ef9dde-fab9-47ff-b5b3-61d519af2ac6` produced two grounded
independent-judge false negatives after evaluator PASS:

1. `createKernelHandlers()['spawn:judge']` did not pass `promptDir` to
   `runJudgeGate()`. `harness-judge.js` can resolve the evaluator's full
   `<taskId>.*.stdout` transcript only when both `promptDir` and `taskId` are
   present, so the kernel path silently degraded to the callback summary.
2. The judge prompt required every Golden Path step to be completed at judge
   time. That incorrectly required authenticated human review, merge, and
   reporting evidence before the independent judge had passed, contradicting
   the enforced sequence:

   `evaluator PASS → independent judge PASS → merge_gate review → approve → merge`

The delivery PR and evaluator evidence were valid. The failure was at the
kernel-to-judge evidence and stage-semantics boundary.

## Approved invariants

- The independent judge remains fail-closed.
- Mechanical evidence checks and `validateCoverage()` remain enabled and are
  not weakened.
- No natural-language progress claim is trusted as a stage fact.
- `merge_gate_approved` must reuse ground truth's current-head, server-derived,
  merge-gate-only approval result. Evidence/unknown approvals and legacy rows
  without a review class remain fail-closed.
- A PR already merged, or a merge-gate approval already recorded before judge
  PASS, is a terminal judge failure.
- Post-judge actions are not required to have happened at judge time. Their
  coverage is satisfied only by structured proof that they have *not* happened
  early and that the current stage is `independent_judge`.

## Considered approaches

### A. Prompt-only clarification

Add wording that human review and merge happen later.

Rejected: the judge currently receives no authoritative stage facts. A model
would still have to infer state from prose or missing logs.

### B. Natural-language step filtering in code

Skip Golden Path steps whose text contains `human review`, `merge`, or
`report`.

Rejected: string heuristics would make an authorization boundary depend on
wording and language.

### C. Explicit evidence bridge plus structured stage facts (selected)

Inject the host prompt directory from the existing `getHostPromptDir()` SSOT,
and pass immutable stage facts from `ctx.observed` into the judge. The prompt
uses those facts to interpret post-judge steps as sequencing preconditions,
while a deterministic preflight rejects premature approval or merge.

This is the smallest change that preserves all existing gates and fixes both
observed failures.

## Design

### Evidence directory dependency

`buildDefaultHandlers()` resolves the host prompt directory using
`getHostPromptDir()` from `docker-executor.js` and passes it as
`deps.promptDir` to `createKernelHandlers()`.

The `spawn:judge` handler passes `deps.promptDir` to `judgeGate()`. The handler
must not read environment variables directly; path resolution stays in the
existing docker-executor SSOT.

### Structured stage facts

The handler passes:

```js
{
  current_stage: 'independent_judge',
  pr_state: ctx.observed.pr?.state ?? null,
  pr_merged: ctx.observed.pr?.merged === true,
  head_sha: ctx.observed.pr?.head_sha ?? null,
  merge_gate_approved: ctx.observed.reviewApproved === true,
}
```

`reviewApproved` is already produced by ground truth from a current-SHA,
merge-gate-class approval. The hotfix does not re-derive it from decision-log
text.

### Deterministic stage preflight

Before DeepSeek is called, the judge rejects an `independent_judge` stage when:

- `head_sha` is absent;
- `pr_merged` is not exactly `false`;
- `merge_gate_approved` is not exactly `false`.

The failure is evidence-invalid and no merge is attempted.

### Prompt semantics

The prompt includes a JSON block of `stageFacts` and states:

- steps that occur after independent judge PASS are sequencing obligations;
- at judge time they are covered by structured proof of the correct
  precondition, not by proof that the future action already occurred;
- missing future approval/merge/report logs must not be treated as missing
  evidence;
- a consolidated contract E2E command with exit code 0 and a non-empty log
  tail is direct structured evidence for the assertions in that exact contract
  script; the judge must not require the evaluator to paste the same stdout a
  second time;
- all pre-judge product/evidence steps still require real command evidence.

## Data flow

```text
getHostPromptDir()
  → buildDefaultHandlers deps.promptDir
  → kernel spawn:judge
     ├─ promptDir + taskId → full evaluator stdout
     └─ ctx.observed → stageFacts
  → deterministic stage preflight
  → independent judge prompt
  → existing coverage validation
  → existing merge gate
```

## Testing strategy

### Unit

- Kernel handler passes the injected `promptDir`.
- Kernel handler passes exact `stageFacts` from `ctx.observed`.
- Judge prompt contains the stage-fact JSON and explicit post-judge/consolidated
  script rules.
- Deterministic stage preflight passes only for an open, unapproved current
  head and rejects missing head, premature merge, and premature merge-gate
  approval.

### Integration/regression

- Existing harness-judge and kernel-handler suites remain green.
- Existing human-review-class and ground-truth suites prove
  `reviewApproved` remains current-SHA, merge-gate-only, and fail-closed for
  legacy classless approvals.

### Real smoke

A Brain smoke script invokes the real judge prompt/preflight path with:

- evaluator evidence plus a consolidated contract E2E result;
- `current_stage=independent_judge`;
- PR open and no merge-gate approval.

It asserts the stage preflight allows independent judging, while premature
merge and premature approval are rejected.

## Version and rollout

This changes `packages/brain/src`, so the Brain patch version is bumped in all
required ledgers. The hotfix ships in an independent PR to `main`, deploys
before resuming R9, and then R9 reuses the same task, run, PR, and approved
contract.
