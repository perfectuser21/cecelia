# Kernel Atomic Inventory Appendix: P0 Evaluation, Review, and Release

日期：2026-07-29

状态：规范性附录

范围：P0-05、P0-06、P0-07
上位设计：`docs/superpowers/specs/2026-07-29-kernel-atomic-behavior-classification-design.md`

## 0. 规范性结论

本附录锁定 P0-05..P0-07 的 corrected inventory：

- 10 个 atomic invariants；
- 116 个 canonical probe definitions；
- 22 个 normal probes、84 个 violation probes、10 个 recovery probes；
- 3 个 `active_required`，7 个 `drifted_required_gap`；
- 所有 10 个 atom 当前 `proof_status` 均为 `gap`；
- 3 个 Provider 下必须执行 116 × 3 = 348 个 provider-probe assertions；
- 结果聚合进既有 3 family × 3 Provider × 3 scenario = 27 个 family cells，不新增顶层
  family cell。

`classification` 只描述 legacy truth，不能因 Kernel 后续补齐而改写。`proof_status` 描述
Kernel target 是否已经有 atom-bound signer、完整 probes 和 live receipts。旧代码存在、
甚至已具备较强安全实现，不等于 Kernel target 已被证明。

## 1. 执行和聚合规则

完整 probe identity 为：

```text
invariant_id::probe_id::provider::scenario
```

本附录的 `probe_id` 在 atom 内永久稳定。每个 probe 必须由 atom 的单一 effect owner/seam
执行或观察并签署。family collector 只能验证、汇总 subreceipts，不得代替 atom owner
签署 effect。

场景规则：

- `normal`：运行该 atom 的全部 `Nxx` probes；
- `violation`：运行该 atom 的全部 `Vxx` probes，每个 probe 是一个可独立失败条件；
- `recovery`：运行该 atom 的 `R01`，并绑定本节列出的 exact violation predecessor；
- recovery receipt 必须绑定同 provider、同 case、同 artifact SHA、同 resource generation
  和 exact predecessor receipt ID；
- 旧失败 receipt 不得删除、覆盖或被新 PASS 反向解释为成功。

期望结果词汇：

- `confirmed`：目标效果被独立观察并确认；
- `denied`：在受保护效果发生前拒绝；
- `blocked`：缺少前置权威或证据，状态不得前进；
- `unknown`：效果无法确认，禁止 fail-open；
- `recovered`：修正后的新执行成功，且保留、绑定旧失败。

## 2. Inventory summary

| Invariant ID | Family atom | Classification | Single effect owner/seam | Legacy truth | Kernel target |
|---|---|---|---|---|---|
| `KERNEL-INV-P0-05-01` | exact-head CI authority | `active_required` | `kernel.ci.exact_head_observer` | 当前 merge 路径主动要求 current-head required checks | `gap`：无 atom-bound signer、完整 probes、live receipts |
| `KERNEL-INV-P0-05-02` | evaluator result authority | `active_required` | `kernel.evaluation.evaluator_result_authority` | 当前 handler 主动校验独立 Attempt、result digest、head 与 lease | `gap` |
| `KERNEL-INV-P0-05-03` | independent judge | `drifted_required_gap` | `kernel.evaluation.independent_judge` | equivalence seam 已存在，但 direct judge 有 contract/model fail-open，且 nonzero exit 未被完整拒绝 | `gap` |
| `KERNEL-INV-P0-06-01` | post-diff risk authority | `drifted_required_gap` | `kernel.review.post_diff_risk_authority` | server policy 较完整，但 relay 仍可接受 caller false，DB 写失败也可继续 | `gap` |
| `KERNEL-INV-P0-06-02` | human approval authority | `drifted_required_gap` | `kernel.merge.human_review_authority` | merge consumer 使用 decision log；legacy approval route 仍写 dead `task_events` graph | `gap` |
| `KERNEL-INV-P0-07-01` | ReleaseRun authority | `active_required` | `kernel.release.run_authority` | durable executor、effect authorization、observe-before-act 已接线 | `gap` |
| `KERNEL-INV-P0-07-02` | nightly quality authority | `drifted_required_gap` | `kernel.release.nightly_quality_authority` | repo/workflow/branch/status/freshness 已校验，但 nightly head 未绑定 release merge 或受控 ancestry | `gap` |
| `KERNEL-INV-P0-07-03` | staging promotion | `drifted_required_gap` | `kernel.release.staging_promotion` | ReleaseRun adapter 较强；legacy staging E2E 对空 SHA fail-open | `gap` |
| `KERNEL-INV-P0-07-04` | production promotion | `drifted_required_gap` | `kernel.release.production_promotion` | legacy staging PASS 曾拥有直接 production authority；统一 production atom assembly 尚未完成 | `gap` |
| `KERNEL-INV-P0-07-05` | rollback authority | `drifted_required_gap` | `kernel.release.rollback_authority` | ReleaseRun rollback 已较完整，但 legacy 存在部分、平行 authority，尚无 atom proof | `gap` |

## 3. P0-05 Evaluation

### 3.1 `KERNEL-INV-P0-05-01` — Exact-head CI authority

```yaml
classification: active_required
proof_status: gap
single_effect_owner_seam: kernel.ci.exact_head_observer
steps: [S5, S6, S7, S9]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]
probe_counts: { normal: 1, violation: 4, recovery: 1, total: 6 }
```

Legacy truth：merge gate 已主动要求当前 PR head、CI PASS 和 canonical required checks。
Kernel gap 是没有 CI atom owner 签署的逐 probe effect receipt。

Repo evidence：

- `packages/brain/src/orchestrator/gates.js`
- `packages/brain/src/orchestrator/merge-authority.js`
- `packages/brain/src/orchestrator/post-diff-risk-policy.js`
- `packages/brain/src/orchestrator/__tests__/gates.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-05-01-N01` | normal | 当前 open PR 的 exact head 上，全部 canonical required checks 均由可信 GitHub source/app 报告 `SUCCESS`，且 context 唯一。 | confirmed |
| `KERNEL-PROBE-P0-05-01-V01` | violation | required checks 集合缺失或为空时，禁止产生 CI PASS authority。 | denied |
| `KERNEL-PROBE-P0-05-01-V02` | violation | 任一 required check 为 failed、pending、skipped、cancelled 或其他非 `SUCCESS` 状态时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-01-V03` | violation | check suite、run、job 或 status 绑定 stale/different head 时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-01-V04` | violation | source/app 不可信、run/job/status ID 畸形，或 required context 重复时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-01-R01` | recovery | 在修正后的 current head 上取得全新可信 SUCCESS checks；新 receipt 必须绑定被替代的 `V01`、`V02`、`V03` 或 `V04` exact predecessor，旧结果不可复用。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-05-01-N01]
violation: [KERNEL-PROBE-P0-05-01-V01, KERNEL-PROBE-P0-05-01-V02,
            KERNEL-PROBE-P0-05-01-V03, KERNEL-PROBE-P0-05-01-V04]
recovery:
  probe: KERNEL-PROBE-P0-05-01-R01
  recovers: [KERNEL-PROBE-P0-05-01-V01, KERNEL-PROBE-P0-05-01-V02,
             KERNEL-PROBE-P0-05-01-V03, KERNEL-PROBE-P0-05-01-V04]
```

### 3.2 `KERNEL-INV-P0-05-02` — Evaluator result authority

```yaml
classification: active_required
proof_status: gap
single_effect_owner_seam: kernel.evaluation.evaluator_result_authority
steps: [S6, S7, S9]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]
probe_counts: { normal: 5, violation: 2, recovery: 1, total: 8 }
```

Legacy truth：production handler 已校验 evaluator 与 judge 身份分离、Attempt、TaskBundle、
result digest、current head、terminal lease fence 和执行 receipt。Kernel target 尚无独立
evaluator atom signer 与 live proof。

Repo evidence：

- `packages/brain/src/orchestrator/kernel-handlers.js`
- `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`
- `packages/brain/src/orchestrator/__tests__/attempt-result-receipt.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-05-02-N01` | normal | evaluator 使用独立 Attempt；role/run 正确，Attempt terminal，lease generation 被 fence。 | confirmed |
| `KERNEL-PROBE-P0-05-02-N02` | normal | TaskBundle 的 expected pull request 与 head SHA 精确等于当前 PR/head。 | confirmed |
| `KERNEL-PROBE-P0-05-02-N03` | normal | durable execution receipt 精确绑定 attempt、run、provider、session、worker、job 和 lease。 | confirmed |
| `KERNEL-PROBE-P0-05-02-N04` | normal | persisted result digest、verdict 和 observed artifact 与 evaluator 输出精确一致。 | confirmed |
| `KERNEL-PROBE-P0-05-02-N05` | normal | evaluator PASS 必须包含真实 command、artifact 和行为证据，而非仅有叙述性 verdict。 | confirmed |
| `KERNEL-PROBE-P0-05-02-V01` | violation | behavioral evidence 缺失、为空或命令失败时，禁止产生 evaluator PASS authority。 | denied |
| `KERNEL-PROBE-P0-05-02-V02` | violation | stale head，或 attempt/session/run/worker/job/lease/result digest 任一跨执行错绑时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-02-R01` | recovery | 修正证据后在 current head 创建新的 evaluator Attempt；绑定 `V01` 或 `V02` predecessor，旧 Attempt/result 不可继承。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-05-02-N01, KERNEL-PROBE-P0-05-02-N02,
         KERNEL-PROBE-P0-05-02-N03, KERNEL-PROBE-P0-05-02-N04,
         KERNEL-PROBE-P0-05-02-N05]
violation: [KERNEL-PROBE-P0-05-02-V01, KERNEL-PROBE-P0-05-02-V02]
recovery:
  probe: KERNEL-PROBE-P0-05-02-R01
  recovers: [KERNEL-PROBE-P0-05-02-V01, KERNEL-PROBE-P0-05-02-V02]
```

### 3.3 `KERNEL-INV-P0-05-03` — Independent judge

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.evaluation.independent_judge
steps: [S7, S9]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]
probe_counts: { normal: 1, violation: 9, recovery: 1, total: 11 }
```

Legacy truth：Kernel equivalence seam 已存在，production handler 使用 strict judge；但 direct
judge 在无 contract/GP 或模型失败时可回落到 agent verdict，mechanical gate 仅要求存在
exit code、未完整要求 exit code 为零。因此该 atom 不能标为 active-complete。

Repo evidence：

- `packages/brain/src/orchestrator/kernel-handlers.js`
- `packages/brain/src/harness-judge.js`
- `packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js`
- `packages/brain/src/__tests__/harness-judge.test.js`
- `packages/brain/src/orchestrator/__tests__/judge-default-assembly.integration.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-05-03-N01` | normal | judge 与 evaluator 身份分离，绑定 current head 与 premerge stage，并独立得到 semantic PASS 和 coverage PASS。 | confirmed |
| `KERNEL-PROBE-P0-05-03-V01` | violation | judge 与 implementer/evaluator 相同，或以自身声明自证时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V02` | violation | evaluator Attempt、result、execution receipt 或 authority binding 缺失/不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V03` | violation | judge input 或 evaluator evidence 绑定 stale/different head 时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V04` | violation | PR 已 closed/merged，或 merge authority 已先行批准时禁止产生 premerge judge PASS。 | denied |
| `KERNEL-PROBE-P0-05-03-V05` | violation | `behavior_tests` 缺失或为空时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V06` | violation | command exit/log 缺失，或任一要求命令 exit code 非零时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V07` | violation | contract 或 Golden Path baseline 缺失时必须 fail-closed。 | denied |
| `KERNEL-PROBE-P0-05-03-V08` | violation | semantic verdict 畸形/FAIL，或存在 coverage gap、theater evidence 时拒绝。 | denied |
| `KERNEL-PROBE-P0-05-03-V09` | violation | 模型、网络或 judge backend 不可用时不得继承 agent/evaluator PASS。 | unknown |
| `KERNEL-PROBE-P0-05-03-R01` | recovery | 修正 evidence 后以新 evaluator identity 和新 judge invocation 重判；绑定 `V01`..`V09` 中的 exact predecessor。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-05-03-N01]
violation: [KERNEL-PROBE-P0-05-03-V01, KERNEL-PROBE-P0-05-03-V02,
            KERNEL-PROBE-P0-05-03-V03, KERNEL-PROBE-P0-05-03-V04,
            KERNEL-PROBE-P0-05-03-V05, KERNEL-PROBE-P0-05-03-V06,
            KERNEL-PROBE-P0-05-03-V07, KERNEL-PROBE-P0-05-03-V08,
            KERNEL-PROBE-P0-05-03-V09]
recovery:
  probe: KERNEL-PROBE-P0-05-03-R01
  recovers: [KERNEL-PROBE-P0-05-03-V01, KERNEL-PROBE-P0-05-03-V02,
             KERNEL-PROBE-P0-05-03-V03, KERNEL-PROBE-P0-05-03-V04,
             KERNEL-PROBE-P0-05-03-V05, KERNEL-PROBE-P0-05-03-V06,
             KERNEL-PROBE-P0-05-03-V07, KERNEL-PROBE-P0-05-03-V08,
             KERNEL-PROBE-P0-05-03-V09]
```

## 4. P0-06 Risk-based Human Review

### 4.1 `KERNEL-INV-P0-06-01` — Post-diff risk authority

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.review.post_diff_risk_authority
steps: [S8, S9]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]
probe_counts: { normal: 1, violation: 20, recovery: 1, total: 22 }
```

Legacy truth：server-side post-diff policy 能分类保护路径、规模、receipt 和 gate 状态；但 legacy
relay 允许显式 `review_required: false` 覆盖，并在 DB write 失败时继续。因此 caller hint
和服务端 authority 尚未统一。

Repo evidence：

- `packages/brain/src/orchestrator/post-diff-risk-policy.js`
- `packages/brain/src/orchestrator/merge-authority.js`
- `packages/brain/src/harness-skill-relay.js`
- `packages/brain/src/orchestrator/post-diff-risk-policy.test.js`
- `packages/brain/src/orchestrator/post-diff-risk-hardening.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-06-01-N01` | normal | 仅当 diff 小型、非保护路径、无新 capability，可信 current production receipt 有效，且 CI/evaluator/judge 全绿时，服务端可判定 auto-review eligible。 | confirmed |
| `KERNEL-PROBE-P0-06-01-V01` | violation | contract 或 authoritative input 显式要求 human review 时不得自动免审。 | blocked |
| `KERNEL-PROBE-P0-06-01-V02` | violation | 首次 Kernel release 必须升级风险并要求 review。 | blocked |
| `KERNEL-PROBE-P0-06-01-V03` | violation | 首次行为变更或没有有效 prior production receipt 时不得自动免审。 | blocked |
| `KERNEL-PROBE-P0-06-01-V04` | violation | 新增 capability 时必须升级为 high/review-required。 | blocked |
| `KERNEL-PROBE-P0-06-01-V05` | violation | migration path 变更必须升级风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V06` | violation | CI 或 workflow path 变更必须升级风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V07` | violation | credential、security 或 controller path 变更必须升级风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V08` | violation | deploy 或 release path 变更必须升级风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V09` | violation | core orchestration path 变更必须升级风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V10` | violation | unknown、mixed 或无法规范化的 path 分类必须 fail-closed。 | blocked |
| `KERNEL-PROBE-P0-06-01-V11` | violation | changed file count 大于 5 时至少为 medium，不得 auto-review。 | blocked |
| `KERNEL-PROBE-P0-06-01-V12` | violation | changed line count 大于 200 时至少为 medium，不得 auto-review。 | blocked |
| `KERNEL-PROBE-P0-06-01-V13` | violation | repo/head/base/diff/check/contract/file authority 任一缺失、畸形或不一致时风险为 unknown/high。 | blocked |
| `KERNEL-PROBE-P0-06-01-V14` | violation | prior production receipt stale、drifted、wrong issuer，或无法解析到有效 ReleaseRun 时拒绝低风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V15` | violation | CI 不是 current-head green 时拒绝低风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V16` | violation | evaluator 不是 green/current 时拒绝低风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V17` | violation | judge 不是 green/current 时拒绝低风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V18` | violation | caller 提供 high/unknown hint 时，服务端只允许维持或提高风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V19` | violation | caller 提供 low、false 或 benign task type 时，不得降低服务端派生风险。 | blocked |
| `KERNEL-PROBE-P0-06-01-V20` | violation | assessment 过期，或合并前重验证得到不同 diff/gate/policy 决策时，旧 assessment 失效。 | blocked |
| `KERNEL-PROBE-P0-06-01-R01` | recovery | 修正 authoritative evidence 后重新计算 fresh exact risk proof；绑定 `V01`..`V20` exact predecessor，旧 proof 不可复用。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-06-01-N01]
violation: [KERNEL-PROBE-P0-06-01-V01, KERNEL-PROBE-P0-06-01-V02,
            KERNEL-PROBE-P0-06-01-V03, KERNEL-PROBE-P0-06-01-V04,
            KERNEL-PROBE-P0-06-01-V05, KERNEL-PROBE-P0-06-01-V06,
            KERNEL-PROBE-P0-06-01-V07, KERNEL-PROBE-P0-06-01-V08,
            KERNEL-PROBE-P0-06-01-V09, KERNEL-PROBE-P0-06-01-V10,
            KERNEL-PROBE-P0-06-01-V11, KERNEL-PROBE-P0-06-01-V12,
            KERNEL-PROBE-P0-06-01-V13, KERNEL-PROBE-P0-06-01-V14,
            KERNEL-PROBE-P0-06-01-V15, KERNEL-PROBE-P0-06-01-V16,
            KERNEL-PROBE-P0-06-01-V17, KERNEL-PROBE-P0-06-01-V18,
            KERNEL-PROBE-P0-06-01-V19, KERNEL-PROBE-P0-06-01-V20]
recovery:
  probe: KERNEL-PROBE-P0-06-01-R01
  recovers: [KERNEL-PROBE-P0-06-01-V01, KERNEL-PROBE-P0-06-01-V02,
             KERNEL-PROBE-P0-06-01-V03, KERNEL-PROBE-P0-06-01-V04,
             KERNEL-PROBE-P0-06-01-V05, KERNEL-PROBE-P0-06-01-V06,
             KERNEL-PROBE-P0-06-01-V07, KERNEL-PROBE-P0-06-01-V08,
             KERNEL-PROBE-P0-06-01-V09, KERNEL-PROBE-P0-06-01-V10,
             KERNEL-PROBE-P0-06-01-V11, KERNEL-PROBE-P0-06-01-V12,
             KERNEL-PROBE-P0-06-01-V13, KERNEL-PROBE-P0-06-01-V14,
             KERNEL-PROBE-P0-06-01-V15, KERNEL-PROBE-P0-06-01-V16,
             KERNEL-PROBE-P0-06-01-V17, KERNEL-PROBE-P0-06-01-V18,
             KERNEL-PROBE-P0-06-01-V19, KERNEL-PROBE-P0-06-01-V20]
```

### 4.2 `KERNEL-INV-P0-06-02` — Human approval authority

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.merge.human_review_authority
steps: [S8, S9]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]
probe_counts: { normal: 1, violation: 10, recovery: 1, total: 12 }
```

Legacy truth：merge authority 能精确绑定 current head、post-diff risk、request hop、expiry 和
decision log；但 legacy pending-review route 仍写 `task_events`，而 current consumer
不读取该 dead graph，构成 producer/consumer drift。

Repo evidence：

- `packages/brain/src/orchestrator/merge-authority.js`
- `packages/brain/src/orchestrator/ground-truth.js`
- `packages/brain/src/routes/harness-pending-reviews.js`
- `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
- `packages/brain/src/orchestrator/__tests__/human-review-equivalence-seam.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-06-02-N01` | normal | 认证 approver 的允许决定精确绑定 current task/run/request hop/head/diff/base/contract/policy/risk。 | confirmed |
| `KERNEL-PROBE-P0-06-02-V01` | violation | risk policy 要求 review 而 approval 缺失时禁止 merge。 | denied |
| `KERNEL-PROBE-P0-06-02-V02` | violation | authoritative human decision 为 reject 时禁止 merge。 | denied |
| `KERNEL-PROBE-P0-06-02-V03` | violation | approver 未认证、身份错误或 review class 不满足策略时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V04` | violation | approval 绑定 stale/different head 时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V05` | violation | diff/base/contract/policy/risk 任一 binding drift 时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V06` | violation | request hop 缺失、错误，或没有相匹配的 review request 时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V07` | violation | risk assessment 或 approval 超过 TTL 时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V08` | violation | approval 后出现新 commit、material event 或新的风险决策时，旧 approval 失效。 | denied |
| `KERNEL-PROBE-P0-06-02-V09` | violation | 仅存在 legacy `task_events` approval、decision log 无相应 authority 时拒绝。 | denied |
| `KERNEL-PROBE-P0-06-02-V10` | violation | caller-supplied、伪造或无法验证的 approver identity 不得形成 authority。 | denied |
| `KERNEL-PROBE-P0-06-02-R01` | recovery | 基于修正后的 current binding 重新请求并取得新 approval；绑定 `V01`..`V10` exact predecessor。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-06-02-N01]
violation: [KERNEL-PROBE-P0-06-02-V01, KERNEL-PROBE-P0-06-02-V02,
            KERNEL-PROBE-P0-06-02-V03, KERNEL-PROBE-P0-06-02-V04,
            KERNEL-PROBE-P0-06-02-V05, KERNEL-PROBE-P0-06-02-V06,
            KERNEL-PROBE-P0-06-02-V07, KERNEL-PROBE-P0-06-02-V08,
            KERNEL-PROBE-P0-06-02-V09, KERNEL-PROBE-P0-06-02-V10]
recovery:
  probe: KERNEL-PROBE-P0-06-02-R01
  recovers: [KERNEL-PROBE-P0-06-02-V01, KERNEL-PROBE-P0-06-02-V02,
             KERNEL-PROBE-P0-06-02-V03, KERNEL-PROBE-P0-06-02-V04,
             KERNEL-PROBE-P0-06-02-V05, KERNEL-PROBE-P0-06-02-V06,
             KERNEL-PROBE-P0-06-02-V07, KERNEL-PROBE-P0-06-02-V08,
             KERNEL-PROBE-P0-06-02-V09, KERNEL-PROBE-P0-06-02-V10]
```

## 5. P0-07 Release

### 5.1 `KERNEL-INV-P0-07-01` — ReleaseRun authority

```yaml
classification: active_required
proof_status: gap
single_effect_owner_seam: kernel.release.run_authority
steps: [S9, S10, S11, S12]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, death_alert,
   failure_semantics, effect_confirmation, ledger_freshness, axis_alignment]
probe_counts: { normal: 4, violation: 5, recovery: 1, total: 10 }
```

Legacy truth：default Kernel handlers 已接入 durable ReleaseRun executor 和 adapters；
effect authorization 使用 state、release ID、merge SHA、idempotency 与 intent，并执行
observe-before-act。缺口是 atom-specific signer/probe/live proof。

Repo evidence：

- `packages/brain/src/orchestrator/release-run-executor.js`
- `packages/brain/src/orchestrator/release-run-contract.js`
- `packages/brain/src/orchestrator/release-run-authorization.js`
- `packages/brain/src/orchestrator/release-run-store.js`
- `packages/brain/src/orchestrator/run.js`
- `packages/brain/src/orchestrator/__tests__/release-run-executor.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-07-01-N01` | normal | exact merge receipt 对同一 run/task/source/merge identity 只创建一个 durable ReleaseRun。 | confirmed |
| `KERNEL-PROBE-P0-07-01-N02` | normal | ReleaseRun 固定 exact artifact set、digest 和 required E2E manifest/scenarios/probes。 | confirmed |
| `KERNEL-PROBE-P0-07-01-N03` | normal | ReleaseRun 状态只允许 append-only、monotonic、contract-allowed 转换。 | confirmed |
| `KERNEL-PROBE-P0-07-01-N04` | normal | staging/production effect intent 具有 scoped state、SHA、effect kind 和唯一 idempotency key。 | confirmed |
| `KERNEL-PROBE-P0-07-01-V01` | violation | 同一 identity 的 run/task/source/merge SHA 冲突时拒绝创建或复用。 | denied |
| `KERNEL-PROBE-P0-07-01-V02` | violation | authorization 的 state、release ID、SHA、idempotency 或 effect kind 不匹配时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-01-V03` | violation | concurrent/expired claim 使用错误 generation 或越过 fence 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-01-V04` | violation | failed/unknown dispatch 或仅有 command success 时不得写成 confirmed effect。 | unknown |
| `KERNEL-PROBE-P0-07-01-V05` | violation | store、adapter、artifact resolver 或 required E2E manifest 缺失时阻止 release 状态前进。 | blocked |
| `KERNEL-PROBE-P0-07-01-R01` | recovery | 进程重启后先观察再执行，复用 exact intent/receipt 并协调 `V01`..`V05` predecessor，不产生重复 effect。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-07-01-N01, KERNEL-PROBE-P0-07-01-N02,
         KERNEL-PROBE-P0-07-01-N03, KERNEL-PROBE-P0-07-01-N04]
violation: [KERNEL-PROBE-P0-07-01-V01, KERNEL-PROBE-P0-07-01-V02,
            KERNEL-PROBE-P0-07-01-V03, KERNEL-PROBE-P0-07-01-V04,
            KERNEL-PROBE-P0-07-01-V05]
recovery:
  probe: KERNEL-PROBE-P0-07-01-R01
  recovers: [KERNEL-PROBE-P0-07-01-V01, KERNEL-PROBE-P0-07-01-V02,
             KERNEL-PROBE-P0-07-01-V03, KERNEL-PROBE-P0-07-01-V04,
             KERNEL-PROBE-P0-07-01-V05]
```

### 5.2 `KERNEL-INV-P0-07-02` — Nightly quality authority

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.release.nightly_quality_authority
steps: [S10, S11]
dimensions:
  [nfr, invariant, checkpoint, freshness, death_alert, failure_semantics,
   effect_confirmation, adversarial_surface, ledger_freshness]
probe_counts: { normal: 1, violation: 8, recovery: 1, total: 10 }
```

Legacy truth：当前 quality validator 要求 exact repo、`nightly-regression.yml`、`main`、完成、
成功、run ID、URL 和 48 小时 freshness；但 `head_sha` 只做形状检查，未要求等于本次
release merge SHA，也未定义可接受的祖先/受控关系。

Repo evidence：

- `packages/brain/src/orchestrator/release-run-quality.js`
- `packages/brain/src/orchestrator/release-run-adapters.js`
- `packages/brain/src/orchestrator/__tests__/release-run-quality.test.js`
- `.github/workflows/nightly-regression.yml`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-07-02-N01` | normal | evidence 精确绑定目标 repo、`nightly-regression.yml`、`main`、completed/success、run ID/URL、受控 head，且 age 不超过 48 小时。 | confirmed |
| `KERNEL-PROBE-P0-07-02-V01` | violation | nightly evidence 来自错误 repo 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V02` | violation | workflow 名称或 identity 不是 canonical nightly workflow 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V03` | violation | branch 不是 `main` 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V04` | violation | run ID 或 URL 畸形、相互不一致或指向其他 run 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V05` | violation | conclusion 非 success，或 status 非 completed 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V06` | violation | timestamp 在未来或 freshness 超过 48 小时时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V07` | violation | head SHA 无效、与 release 无关，或无法证明为允许的 exact/ancestor controlled relation 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-02-V08` | violation | GitHub observation unavailable、empty、ambiguous 或有多个不可消歧候选时 fail-closed。 | unknown |
| `KERNEL-PROBE-P0-07-02-R01` | recovery | 获取新的、受控 head 上的 fresh nightly success；绑定 `V01`..`V08` predecessor并保留旧 evidence。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-07-02-N01]
violation: [KERNEL-PROBE-P0-07-02-V01, KERNEL-PROBE-P0-07-02-V02,
            KERNEL-PROBE-P0-07-02-V03, KERNEL-PROBE-P0-07-02-V04,
            KERNEL-PROBE-P0-07-02-V05, KERNEL-PROBE-P0-07-02-V06,
            KERNEL-PROBE-P0-07-02-V07, KERNEL-PROBE-P0-07-02-V08]
recovery:
  probe: KERNEL-PROBE-P0-07-02-R01
  recovers: [KERNEL-PROBE-P0-07-02-V01, KERNEL-PROBE-P0-07-02-V02,
             KERNEL-PROBE-P0-07-02-V03, KERNEL-PROBE-P0-07-02-V04,
             KERNEL-PROBE-P0-07-02-V05, KERNEL-PROBE-P0-07-02-V06,
             KERNEL-PROBE-P0-07-02-V07, KERNEL-PROBE-P0-07-02-V08]
```

### 5.3 `KERNEL-INV-P0-07-03` — Staging promotion

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.release.staging_promotion
steps: [S10, S11]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, death_alert,
   failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness]
probe_counts: { normal: 3, violation: 8, recovery: 1, total: 12 }
```

Legacy truth：ReleaseRun adapter 能校验 staging status、artifact set、health、merge/version、
E2E 和 verification claim；legacy staging E2E runner 仅在 tested/current SHA 两端均非空
时比较，空 SHA 可 fail-open。

Repo evidence：

- `packages/brain/src/orchestrator/release-run-executor.js`
- `packages/brain/src/orchestrator/release-run-adapters.js`
- `packages/brain/src/orchestrator/release-run-contract.js`
- `packages/brain/src/staging-e2e-runner.js`
- `packages/brain/src/orchestrator/__tests__/release-run-adapters.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-07-03-N01` | normal | observation 为 `not_applied` 时，只允许一次 exact authorized staging dispatch。 | confirmed |
| `KERNEL-PROBE-P0-07-03-N02` | normal | observation 已证明 exact SHA/artifacts applied 时，只记录 observation，不重复 dispatch。 | confirmed |
| `KERNEL-PROBE-P0-07-03-N03` | normal | tested/deployed SHA、artifacts、health、version、E2E 与 dispatch verification claim 精确后才进入 `staging_passed`。 | confirmed |
| `KERNEL-PROBE-P0-07-03-V01` | violation | tested SHA 或 deployed SHA 为空、畸形或不等于 release merge SHA 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-V02` | violation | artifact set、version 或 digest 与 ReleaseRun contract 不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-V03` | violation | dispatch verification claim 缺失、签名无效或绑定其他 intent 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-V04` | violation | health 非 green，或 observed brain version/SHA 与 contract 不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-V05` | violation | E2E manifest/scenario/probe/readback 不匹配，或任一要求项 skip/fail 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-V06` | violation | staging status 为 fail/unknown/unavailable/ambiguous 时不得进入 `staging_passed`。 | unknown |
| `KERNEL-PROBE-P0-07-03-V07` | violation | deploy command exit 0 但 post-observation 未确认 exact effect 时不得通过。 | unknown |
| `KERNEL-PROBE-P0-07-03-V08` | violation | foreign/replayed idempotency，或并发 duplicate dispatch，必须在 mutation 前拒绝。 | denied |
| `KERNEL-PROBE-P0-07-03-R01` | recovery | 对同 release/SHA 修正 staging 状态并重新观察；绑定 `V01`..`V08` predecessor，旧失败不可擦除。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-07-03-N01, KERNEL-PROBE-P0-07-03-N02,
         KERNEL-PROBE-P0-07-03-N03]
violation: [KERNEL-PROBE-P0-07-03-V01, KERNEL-PROBE-P0-07-03-V02,
            KERNEL-PROBE-P0-07-03-V03, KERNEL-PROBE-P0-07-03-V04,
            KERNEL-PROBE-P0-07-03-V05, KERNEL-PROBE-P0-07-03-V06,
            KERNEL-PROBE-P0-07-03-V07, KERNEL-PROBE-P0-07-03-V08]
recovery:
  probe: KERNEL-PROBE-P0-07-03-R01
  recovers: [KERNEL-PROBE-P0-07-03-V01, KERNEL-PROBE-P0-07-03-V02,
             KERNEL-PROBE-P0-07-03-V03, KERNEL-PROBE-P0-07-03-V04,
             KERNEL-PROBE-P0-07-03-V05, KERNEL-PROBE-P0-07-03-V06,
             KERNEL-PROBE-P0-07-03-V07, KERNEL-PROBE-P0-07-03-V08]
```

### 5.4 `KERNEL-INV-P0-07-04` — Production promotion

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.release.production_promotion
steps: [S11, S12]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, death_alert,
   failure_semantics, effect_confirmation, adversarial_surface,
   ledger_freshness, axis_alignment]
probe_counts: { normal: 3, violation: 8, recovery: 1, total: 12 }
```

Legacy truth：ReleaseRun executor 已要求 staging、nightly 与 rollback preflight，并在 effect
后观察 production；legacy staging PASS 路径曾能直接 promote。统一 production atom 的
owner assembly、签署和 live proof 尚未完成。

Repo evidence：

- `packages/brain/src/orchestrator/release-run-executor.js`
- `packages/brain/src/orchestrator/release-run-adapters.js`
- `packages/brain/src/orchestrator/release-run-contract.js`
- `packages/brain/src/orchestrator/release-run-authorization.js`
- `packages/brain/src/__tests__/integration/kernel-release-runs.integration.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-07-04-N01` | normal | 仅在 `staging_passed`、nightly quality authority 有效且 rollback preflight 已持久化时允许 production dispatch。 | confirmed |
| `KERNEL-PROBE-P0-07-04-N02` | normal | production claim 精确绑定 state、release ID、merge SHA、effect kind、generation 和 idempotency。 | confirmed |
| `KERNEL-PROBE-P0-07-04-N03` | normal | production observation 证明 same SHA/artifacts、brain/full/dashboard/workflow readback 与 production E2E 后才进入 verified。 | confirmed |
| `KERNEL-PROBE-P0-07-04-V01` | violation | staging 未通过，或 staging receipt 与 release/SHA/artifacts 不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-04-V02` | violation | nightly authority 缺失、过期、workflow 错误或 head 不受控时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-04-V03` | violation | rollback preflight、rollback anchors 或 durable ledger 不可用时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-04-V04` | violation | observed production SHA 或 artifact set/digest 与 release contract 不一致时拒绝 verified。 | denied |
| `KERNEL-PROBE-P0-07-04-V05` | violation | brain health、full status、dashboard build SHA 或 workflow readback 任一不匹配时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-04-V06` | violation | production E2E manifest/scenario/probe/readback mismatch、fail 或 skip 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-04-V07` | violation | observation 为 nonpass/unknown/unavailable/ambiguous 时不得 verified。 | unknown |
| `KERNEL-PROBE-P0-07-04-V08` | violation | confirmed production effect receipt 与 rollback receipt 未同时持久化前，禁止完成状态转换。 | blocked |
| `KERNEL-PROBE-P0-07-04-R01` | recovery | 重启后 observe-before-act，或修正部署后确认 exact state；绑定 `V01`..`V08` predecessor，禁止重复 mutation。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-07-04-N01, KERNEL-PROBE-P0-07-04-N02,
         KERNEL-PROBE-P0-07-04-N03]
violation: [KERNEL-PROBE-P0-07-04-V01, KERNEL-PROBE-P0-07-04-V02,
            KERNEL-PROBE-P0-07-04-V03, KERNEL-PROBE-P0-07-04-V04,
            KERNEL-PROBE-P0-07-04-V05, KERNEL-PROBE-P0-07-04-V06,
            KERNEL-PROBE-P0-07-04-V07, KERNEL-PROBE-P0-07-04-V08]
recovery:
  probe: KERNEL-PROBE-P0-07-04-R01
  recovers: [KERNEL-PROBE-P0-07-04-V01, KERNEL-PROBE-P0-07-04-V02,
             KERNEL-PROBE-P0-07-04-V03, KERNEL-PROBE-P0-07-04-V04,
             KERNEL-PROBE-P0-07-04-V05, KERNEL-PROBE-P0-07-04-V06,
             KERNEL-PROBE-P0-07-04-V07, KERNEL-PROBE-P0-07-04-V08]
```

### 5.5 `KERNEL-INV-P0-07-05` — Rollback authority

```yaml
classification: drifted_required_gap
proof_status: gap
single_effect_owner_seam: kernel.release.rollback_authority
steps: [S11, S12]
dimensions:
  [fr, nfr, invariant, checkpoint, freshness, death_alert,
   failure_semantics, effect_confirmation, adversarial_surface,
   ledger_freshness, axis_alignment]
probe_counts: { normal: 2, violation: 10, recovery: 1, total: 13 }
```

Legacy truth：ReleaseRun rollback authorization、isolated controller worker、mutation lock、
per-artifact route、readback 与 settlement 已有较强实现；但 legacy 仍存在部分和平行
rollback authority，而且尚无统一 seam 的 atom-bound receipts。

Repo evidence：

- `packages/brain/src/orchestrator/release-run-rollback-authorization.js`
- `packages/brain/src/orchestrator/release-run-controller-launcher.js`
- `scripts/lib/release-run-rollback-worker.mjs`
- `packages/brain/src/routes/ops.js`
- `packages/brain/src/orchestrator/__tests__/release-run-rollback-authorization.test.js`
- `packages/brain/src/orchestrator/__tests__/release-run-rollback-routing.test.js`

| Probe ID | Scenario | 规范性 assertion | Expected |
|---|---|---|---|
| `KERNEL-PROBE-P0-07-05-N01` | normal | 仅从 latest `production_verified` exact receipt 创建一个 overall rollback intent 及完整 per-artifact intents/receipts。 | confirmed |
| `KERNEL-PROBE-P0-07-05-N02` | normal | claimed isolated worker 在 mutation lock 下执行全部 canonical routes，独立 readback 精确后以 durable receipt 成功结算。 | confirmed |
| `KERNEL-PROBE-P0-07-05-V01` | violation | 在 `production_verified` 前，或没有 exact production receipt 时，拒绝创建 rollback authority。 | denied |
| `KERNEL-PROBE-P0-07-05-V02` | violation | 出现更新 production receipt/claim 后，旧 rollback authority 立即 stale。 | denied |
| `KERNEL-PROBE-P0-07-05-V03` | violation | per-artifact intent/receipt 缺失、重复或数量与 artifact contract 不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-05-V04` | violation | artifact/route 未知，或 controller image/runtime/identity 与 authority 不一致时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-05-V05` | violation | current version/digest/merge SHA/rollback anchor 任一与 preflight 不一致时拒绝 mutation。 | denied |
| `KERNEL-PROBE-P0-07-05-V06` | violation | claim、lease、generation stale，或 invocation 已被 fence 时拒绝。 | denied |
| `KERNEL-PROBE-P0-07-05-V07` | violation | production mutation lock 或 current authority 丢失时，中止后续 route。 | denied |
| `KERNEL-PROBE-P0-07-05-V08` | violation | 任一 route 部分失败或 compensation 失败时，不得结算为 succeeded。 | blocked |
| `KERNEL-PROBE-P0-07-05-V09` | violation | 独立 readback 与目标 anchor 不一致时，不得结算为 succeeded。 | blocked |
| `KERNEL-PROBE-P0-07-05-V10` | violation | abort/commit outcome 无法确认时，必须终态为 unknown/aborted 并标记 `late_effect_risk`，不得声称 success。 | unknown |
| `KERNEL-PROBE-P0-07-05-R01` | recovery | 重启或 claim 过期后重新观察；去重已完成 routes，对中断流程续作或补偿，再精确 settlement，并绑定 `V01`..`V10` predecessor。 | recovered |

Scenario mapping：

```yaml
normal: [KERNEL-PROBE-P0-07-05-N01, KERNEL-PROBE-P0-07-05-N02]
violation: [KERNEL-PROBE-P0-07-05-V01, KERNEL-PROBE-P0-07-05-V02,
            KERNEL-PROBE-P0-07-05-V03, KERNEL-PROBE-P0-07-05-V04,
            KERNEL-PROBE-P0-07-05-V05, KERNEL-PROBE-P0-07-05-V06,
            KERNEL-PROBE-P0-07-05-V07, KERNEL-PROBE-P0-07-05-V08,
            KERNEL-PROBE-P0-07-05-V09, KERNEL-PROBE-P0-07-05-V10]
recovery:
  probe: KERNEL-PROBE-P0-07-05-R01
  recovers: [KERNEL-PROBE-P0-07-05-V01, KERNEL-PROBE-P0-07-05-V02,
             KERNEL-PROBE-P0-07-05-V03, KERNEL-PROBE-P0-07-05-V04,
             KERNEL-PROBE-P0-07-05-V05, KERNEL-PROBE-P0-07-05-V06,
             KERNEL-PROBE-P0-07-05-V07, KERNEL-PROBE-P0-07-05-V08,
             KERNEL-PROBE-P0-07-05-V09, KERNEL-PROBE-P0-07-05-V10]
```

## 6. Count lock and conformance

| Family | Atoms | Normal | Violation | Recovery | Probe definitions |
|---|---:|---:|---:|---:|---:|
| P0-05 Evaluation | 3 | 7 | 15 | 3 | 25 |
| P0-06 Human risk/review | 2 | 2 | 30 | 2 | 34 |
| P0-07 Release | 5 | 13 | 39 | 5 | 57 |
| **Total** | **10** | **22** | **84** | **10** | **116** |

Conformance requirements：

1. `required_atomic_invariant_count` 对本附录必须为 10。
2. `required_probe_definition_count` 对本附录必须为 116。
3. 每个 atom 恰有一个 `single_effect_owner_seam`，不得并列多个 mutation owner。
4. 每个 atom 恰有一个 `R01`，其 `recovers` 必须覆盖该 atom 的全部 violation probes。
5. 任何 `active_required` 或 `drifted_required_gap` 都不得因 legacy tests 存在而把
   `proof_status` 初始化为 `proven`。
6. P0-05、P0-06、P0-07 的 family cell 只有在相应全部 atom/probe/provider subreceipts
   有效时才能变绿。
7. `KERNEL-PROBE-P0-07-02-V07`、`KERNEL-PROBE-P0-07-03-V01`、
   `KERNEL-PROBE-P0-07-04-V08` 和 `KERNEL-PROBE-P0-07-05-V10` 是发布链路的强制
   fail-closed probes，不得降级为 informational checks。
