# Kernel P0/P1 行为等价报告

- 合同版本：`kernel-equivalence-2026-07-28`
- 评估时间：`2026-07-28T00:00:00.000Z`
- 合同行为数：11（P0 7 / P1 4）
- 有效状态：proven 0 / gap 11 / intentional_replacement 0
- Provider 场景证据：0/99，缺 99
- 轴：13 个步骤（S0–S12）× 11 项行为维度 = 143 个可能单元

> 缺口不是证明。只有绑定 exact SHA/version、未过期 freshness、effect receipt，且 Claude/Codex/Grok × normal/violation/recovery 全覆盖，才是 proven。

## 行为清单

| Behavior | Priority | Claimed | Effective | Steps | Dimensions |
|---|---:|---|---|---|---|
| KERNEL-P0-01-BRANCH-PROTECTION | P0 | gap | gap | S3, S4, S9 | invariant, checkpoint, failure_semantics, adversarial_surface |
| KERNEL-P0-02-CREDENTIAL-GUARD | P0 | gap | gap | S2, S3, S4, S12 | nfr, invariant, freshness, failure_semantics, effect_confirmation, adversarial_surface |
| KERNEL-P0-03-BRANCH-PUSH-GUARD | P0 | gap | gap | S3, S4, S5, S9 | fr, invariant, checkpoint, failure_semantics, effect_confirmation, adversarial_surface |
| KERNEL-P0-04-CI-MERGE-AUTHORITY | P0 | gap | gap | S5, S6, S7, S8, S9 | fr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness |
| KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE | P0 | gap | gap | S6, S7, S8, S9 | fr, nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, axis_alignment |
| KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY | P0 | gap | gap | S1, S7, S8, S9 | nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, axis_alignment |
| KERNEL-P0-07-RELEASE-PROMOTION | P0 | gap | gap | S9, S10, S11, S12 | fr, nfr, invariant, checkpoint, freshness, death_alert, failure_semantics, effect_confirmation, ledger_freshness |
| KERNEL-P1-08-STOP-ORPHAN-LIVENESS | P1 | gap | gap | S2, S4, S5, S6, S7, S10, S11, S12 | nfr, invariant, checkpoint, freshness, death_alert, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness |
| KERNEL-P1-09-DEVGATE-TDD-DOD | P1 | gap | gap | S1, S4, S5, S6 | fr, nfr, invariant, checkpoint, failure_semantics, adversarial_surface, axis_alignment |
| KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION | P1 | gap | gap | S0, S2, S3, S4, S5, S6, S7, S12 | fr, nfr, invariant, checkpoint, freshness, death_alert, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment |
| KERNEL-P1-11-REPORT-LEARNING-CLOSURE | P1 | gap | gap | S1, S6, S7, S9, S10, S11, S12 | fr, nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, ledger_freshness, axis_alignment |

## S0–S12 × 11 要素投影

R = 有真实缺口；P = 证据过期；G = 完整证明；— = 尚未映射。

| Step | fr | nfr | invariant | checkpoint | freshness | death_alert | failure_semantics | effect_confirmation | adversarial_surface | ledger_freshness | axis_alignment |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S0 | R | R | R | R | R | R | R | R | R | R | R |
| S1 | R | R | R | R | R | — | R | R | R | R | R |
| S2 | R | R | R | R | R | R | R | R | R | R | R |
| S3 | R | R | R | R | R | R | R | R | R | R | R |
| S4 | R | R | R | R | R | R | R | R | R | R | R |
| S5 | R | R | R | R | R | R | R | R | R | R | R |
| S6 | R | R | R | R | R | R | R | R | R | R | R |
| S7 | R | R | R | R | R | R | R | R | R | R | R |
| S8 | R | R | R | R | R | — | R | R | R | R | R |
| S9 | R | R | R | R | R | R | R | R | R | R | R |
| S10 | R | R | R | R | R | R | R | R | R | R | R |
| S11 | R | R | R | R | R | R | R | R | R | R | R |
| S12 | R | R | R | R | R | R | R | R | R | R | R |

## Provider × 场景证据矩阵

| Provider | Scenario | Receipted | Required | Missing |
|---|---|---:|---:|---:|
| claude | normal | 0 | 11 | 11 |
| claude | violation | 0 | 11 | 11 |
| claude | recovery | 0 | 11 | 11 |
| codex | normal | 0 | 11 | 11 |
| codex | violation | 0 | 11 | 11 |
| codex | recovery | 0 | 11 | 11 |
| grok | normal | 0 | 11 | 11 |
| grok | violation | 0 | 11 | 11 |
| grok | recovery | 0 | 11 | 11 |

## Legacy → Kernel unified construct 对照

### KERNEL-P0-01-BRANCH-PROTECTION

- 旧行为：Claude Code branch-protect/main-repo-write hooks deny protected-branch mutation.
- 旧证据：`packages/engine/tests/hooks/branch-protect.test.ts`, `packages/engine/tests/hooks/main-repo-write-guard.test.ts`
- Unified constructs：Kernel workspace admission and protected-ref mutation policy; central GitHub mutation broker
- 失败语义：Deny before any protected ref changes; preserve the attempted mutation receipt.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/engine && npx vitest run tests/hooks/branch-protect.test.ts tests/hooks/main-repo-write-guard.test.ts`

### KERNEL-P0-02-CREDENTIAL-GUARD

- 旧行为：Claude Code credential hooks prevent secret persistence, cross-account reuse, and expired credential execution.
- 旧证据：`packages/brain/src/orchestrator/credential-broker.test.js`, `packages/brain/src/__tests__/harness-credentials.test.js`
- Unified constructs：CredentialEnvelope broker; attempt-scoped one-shot credential lease
- 失败语义：Fail closed before provider launch and revoke/clean the attempt-scoped credential.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/orchestrator/credential-broker.test.js src/__tests__/harness-credentials.test.js`

### KERNEL-P0-03-BRANCH-PUSH-GUARD

- 旧行为：Claude Code branch and Bash guards restrict push/merge mutations to the task branch and authorized path.
- 旧证据：`packages/engine/tests/hooks/bash-guard.test.ts`, `packages/brain/src/__tests__/legacy-harness-merge-firewall.test.js`
- Unified constructs：Kernel mutation intent; GitHub mutation broker with exact repository/ref scope
- 失败语义：Reject out-of-scope push or merge before network mutation and record the denial.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/__tests__/legacy-harness-merge-firewall.test.js`

### KERNEL-P0-04-CI-MERGE-AUTHORITY

- 旧行为：CI may evaluate but cannot merge; only an authorized post-evaluation decision may merge the exact reviewed SHA.
- 旧证据：`packages/brain/src/__tests__/harness-ci-gate-branches.test.js`, `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
- Unified constructs：MergeAuthorization decision; exact-SHA merge effect executor and receipt store
- 失败语义：CI success alone never grants merge; stale or mismatched SHA fails closed.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/orchestrator/__tests__/merge-authority.test.js src/orchestrator/__tests__/merge-effect-executor.test.js src/orchestrator/__tests__/merge-effect-store.test.js`

### KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE

- 旧行为：Generator cannot self-certify; evaluator and judge independently measure evidence before merge eligibility.
- 旧证据：`packages/brain/src/__tests__/harness-judge.test.js`, `packages/brain/src/routes/__tests__/harness-judge-verdict-writeback.test.js`
- Unified constructs：Kernel evaluator attempt; independent judge decision and verdict writeback
- 失败语义：Missing, stale, or self-authored evaluation prevents merge authorization.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/__tests__/harness-judge.test.js src/routes/__tests__/harness-judge-verdict-writeback.test.js`

### KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY

- 旧行为：First-time or material changes require human review before merge; explicitly repetitive low-risk work may auto-pass.
- 旧证据：`scripts/ci/invariants/core-inv-03-fixed-needs-judge.mjs`, `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
- Unified constructs：ReviewPolicy decision with risk/repetition inputs; human approval receipt bound to exact SHA
- 失败语义：Unresolved mandatory human review or approval for another SHA blocks merge.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`node scripts/ci/invariants/core-inv-03-fixed-needs-judge.mjs`

### KERNEL-P0-07-RELEASE-PROMOTION

- 旧行为：Merged exact SHA deploys to staging, passes E2E, then promotes that same SHA to production.
- 旧证据：`packages/brain/src/__tests__/staging-e2e-runner-promote.test.js`, `packages/brain/src/routes/__tests__/release-gate.test.js`
- Unified constructs：Kernel post-merge release decision; staging verification and exact-SHA production promotion receipts
- 失败语义：Staging failure, unknown health, or SHA drift prevents production promotion.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner-promote.test.js src/routes/__tests__/release-gate.test.js`

### KERNEL-P1-08-STOP-ORPHAN-LIVENESS

- 旧行为：Stop hook, watchdog, and orphan guard distinguish live, dead, and uncertain sessions and recover without false death.
- 旧证据：`packages/engine/tests/hooks/stop-hook-retry.test.ts`, `packages/brain/src/lib/__tests__/harness-orphan-guard.test.js`
- Unified constructs：executor-kind-aware Kernel liveness resolver; attempt heartbeat/PID recovery contract
- 失败语义：Unknown liveness fails open for destructive cleanup; confirmed host-local ESRCH may mark dead and recover.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/lib/__tests__/harness-orphan-guard.test.js`

### KERNEL-P1-09-DEVGATE-TDD-DOD

- 旧行为：Claude Code DevGate enforces test-first evidence, coverage, fake-test rejection, and definition-of-done before PR readiness.
- 旧证据：`packages/engine/tests/devgate/check-tdd-commit-order-red-evidence.test.ts`, `packages/engine/tests/devgate/quickcheck-dod-guard.test.ts`
- Unified constructs：Kernel quality checkpoint contract; provider-neutral DevGate invocation
- 失败语义：Missing RED evidence, fake tests, or unmet DoD blocks evaluator admission.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/engine && npx vitest run tests/devgate/check-tdd-commit-order-red-evidence.test.ts tests/devgate/quickcheck-dod-guard.test.ts`

### KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION

- 旧行为：One session harness has one authoritative controller; attempts, workspace, branch, and callbacks remain session-scoped.
- 旧证据：`packages/engine/tests/skills/harness-controller-kernel-contract.test.ts`, `packages/brain/src/__tests__/harness-complete-account-guard.test.js`
- Unified constructs：shared Kernel controller contract; attempt ownership and idempotent callback authority
- 失败语义：Ambiguous controller ownership or cross-session callback fails closed without completing the task.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/engine && npx vitest run tests/skills/harness-controller-kernel-contract.test.ts`

### KERNEL-P1-11-REPORT-LEARNING-CLOSURE

- 旧行为：Completion emits evidence-backed report and learning artifacts only after verified effects.
- 旧证据：`packages/brain/scripts/__tests__/harness-report.test.mjs`, `packages/brain/src/__tests__/auto-learning.test.js`
- Unified constructs：Kernel result/effect evidence envelope; report and learning closure checkpoint
- 失败语义：Missing or stale effect evidence prevents a green completion report and learning closure.
- Freshness：verified — / expires —
- 部分行为证据（不等于 proven）：`cd packages/brain && npx vitest run src/__tests__/auto-learning.test.js scripts/__tests__/harness-report.test.mjs`

## Proven-to-fire 命令

没有命令达到完整 proven-to-fire 证据门槛。

## 真实缺口

### KERNEL-P0-01-BRANCH-PROTECTION（P0）

- 原因：No provider-specific 3x3 production-effect receipts bind the legacy hook behavior to Kernel enforcement.
- Owner：engine-platform
- 收口计划：Run protected-ref normal/violation/recovery drills for Claude, Codex, and Grok and retain denied mutation receipts.

### KERNEL-P0-02-CREDENTIAL-GUARD（P0）

- 原因：Unit behavior exists, but no complete provider-specific violation and recovery receipts exist for all three providers.
- Owner：security-platform
- 收口计划：Exercise valid, expired/cross-account, and refreshed leases for each provider and capture launch plus cleanup effects.

### KERNEL-P0-03-BRANCH-PUSH-GUARD（P0）

- 原因：The unified mutation path has tests but lacks provider-attributed normal, denial, and recovery effect receipts.
- Owner：kernel-runtime
- 收口计划：Run broker drills for scoped push, forbidden ref, and corrected-ref retry for all providers.

### KERNEL-P0-04-CI-MERGE-AUTHORITY（P0）

- 原因：The exact-SHA contract is tested locally, but no 3x3 provider-attributed live GitHub effect receipt set exists.
- Owner：release-platform
- 收口计划：Run allowed, stale-SHA denial, and refreshed-authorization retry through the real mutation broker for each provider.

### KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE（P0）

- 原因：Judge mechanics are tested, but generator/evaluator identity separation and recovery are not receipted across providers.
- Owner：evaluation-platform
- 收口计划：Execute independent pass, self-certification denial, and reassigned evaluator recovery for all providers.

### KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY（P0）

- 原因：The desired first-time/material-versus-repetitive policy lacks a single implemented and receipted Kernel decision contract.
- Owner：governance-platform
- 收口计划：Define the review classifier, bind approval to artifact SHA, and drill mandatory, bypass-denied, and renewed-approval paths.

### KERNEL-P0-07-RELEASE-PROMOTION（P0）

- 原因：Local release-gate tests do not constitute three-provider staging and production effect receipts for the same SHA.
- Owner：release-platform
- 收口计划：Run same-SHA happy path, staging/E2E denial, and corrected redeploy recovery for every provider-originated artifact.

### KERNEL-P1-08-STOP-ORPHAN-LIVENESS（P1）

- 原因：Kernel liveness migration covers core paths but zero-attempt visibility and provider-specific recovery receipts remain absent.
- Owner：reliability-platform
- 收口计划：Drill live, false-death, confirmed-death, and resumed-attempt behavior for all providers including zero-attempt runs.

### KERNEL-P1-09-DEVGATE-TDD-DOD（P1）

- 原因：Legacy DevGate tests exist, but Kernel invocation parity is not demonstrated with 3x3 provider execution receipts.
- Owner：quality-platform
- 收口计划：Run clean, intentionally invalid, and corrected DevGate tasks through Claude, Codex, and Grok Kernel attempts.

### KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION（P1）

- 原因：A shared controller contract test exists, but authoritative ownership and recovery effects are not receipted per provider.
- Owner：kernel-runtime
- 收口计划：Run single-owner success, dual-controller denial, and ownership-recovery scenarios for all providers.

### KERNEL-P1-11-REPORT-LEARNING-CLOSURE（P1）

- 原因：Report and learning tests are not bound to provider-specific end-to-end effect receipts and freshness windows.
- Owner：learning-platform
- 收口计划：Execute complete, stale-evidence denial, and refreshed-evidence recovery closures for every provider.
