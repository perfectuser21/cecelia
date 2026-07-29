# Kernel Atomic Contract Honesty Addendum

日期：2026-07-29  
状态：已批准设计补充  
修订对象：

- `2026-07-29-kernel-atomic-behavior-classification-design.md`
- 三份 `2026-07-29-kernel-atomic-inventory-*.md` 规范性附录

## 1. 为什么需要本补充

A2-0 首次把三份附录机械写入根 `regression-contract.yaml` 后，43 个 atoms、446 个
probes、identity、classification、owner/seam 和 family axes 全部对账成功，validator
也没有 finding。但是逐 probe 复核发现，原 schema 会制造四类语义漂移：

1. atom-level `violation.expected_outcome=denied` 会把附录明确写出的 `blocked` 或
   `unknown` 压平为 `denied`；
2. validator 要求全部 violation 立即进入 exact recovery binding，迫使生成器为附录
   未明确的关系发明 predecessor 或 recovery chain；
3. retired probe 的 exact-field 规则不允许保存 assertion；
4. intentional replacement 的互斥规则不允许保存旧实现的 repository evidence。

因此，“schema valid”可能只证明格式闭合，不能证明合同忠实。A2-0 必须先修正表达能力，
再接受根 inventory。

## 2. 权威顺序

任何 atomic fact 按以下顺序确定，低层不得覆盖高层：

1. **Appendix explicit**：规范性附录明确给出的 ID、assertion、Expected、owner/seam、
   predecessor 或 chain；
2. **Approved design derivation**：可由已批准设计的确定性规则唯一推出的事实；
3. **Coverage gap**：没有唯一答案的事实，必须显式标红；
4. **禁止 silent inference**：实现者、生成器和 validator 不得把“可能”写成 exact。

`unknown` 是一个可以由附录明确要求的 expected outcome，不等于 schema gap。
`coverage_gap` 表示合同关系本身尚未被规范或证据唯一确定。

## 3. Per-probe expected outcome

每个 proof-required `probe_definition` 必须保存：

```yaml
- probe_id: KERNEL-PROBE-P0-07-01-V04
  scenario: violation
  assertion: "failed/unknown dispatch or command success alone must not become a confirmed effect."
  expected_outcome: unknown
  expectation_authority:
    kind: appendix_explicit
    normative_ref: docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p0-evaluation-release.md
```

`expected_outcome` 允许：

```text
confirmed
denied
blocked
unknown
recovered
absent
```

`expectation_authority.kind` 只允许：

- `appendix_explicit`：附录逐 probe 明示；
- `design_derived`：由批准设计的 scenario 语义唯一推出，必须带 `derivation_ref`；
- `coverage_gap`：预期本身尚不确定，必须带 owner、reason、closure_plan。

atom-level `receipt_requirements.scenarios.<scenario>.expected_outcome`：

- 同一 scenario 的全部 probe outcome 相同时，可保存该 outcome；
- outcome 不同必须写 `per_probe`；
- `per_probe` 不能替代每个 probe 自己的 `expected_outcome`。

下列 11 个 P0 probes 的附录 outcome 必须逐项保留，不能归一为 `denied`：

```text
KERNEL-PROBE-P0-05-03-V09 = unknown
KERNEL-PROBE-P0-07-01-V04 = unknown
KERNEL-PROBE-P0-07-01-V05 = blocked
KERNEL-PROBE-P0-07-02-V08 = unknown
KERNEL-PROBE-P0-07-03-V06 = unknown
KERNEL-PROBE-P0-07-03-V07 = unknown
KERNEL-PROBE-P0-07-04-V07 = unknown
KERNEL-PROBE-P0-07-04-V08 = blocked
KERNEL-PROBE-P0-07-05-V08 = blocked
KERNEL-PROBE-P0-07-05-V09 = blocked
KERNEL-PROBE-P0-07-05-V10 = unknown
```

## 4. Recovery mapping honesty

### 4.1 Exact 与 derived bindings

明确关系继续写入：

```yaml
scenario_plan:
  recovery:
    required_probe_ids: [KERNEL-PROBE-P1-10-01-R01, KERNEL-PROBE-P1-10-01-R02]
    bindings:
      - recovery_probe_id: KERNEL-PROBE-P1-10-01-R01
        predecessor_probe_ids: [KERNEL-PROBE-P1-10-01-V03]
        authority:
          kind: appendix_explicit
          normative_ref: docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p1.md
      - recovery_probe_id: KERNEL-PROBE-P1-10-01-R02
        predecessor_probe_ids:
          - KERNEL-PROBE-P1-10-01-V02
          - KERNEL-PROBE-P1-10-01-R01
        authority:
          kind: appendix_explicit
          normative_ref: docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p1.md
```

`design_derived` binding 只允许在 approved design 能唯一推出 exact predecessor set 时使用，
并必须保存 `derivation_ref`。不能用“绑定全部 V”把歧义伪装成安全。

### 4.2 Coverage gaps

每个 violation 和 recovery obligation 必须进入以下二者之一：

- 一个 `appendix_explicit` 或 `design_derived` binding；
- 一个显式 `coverage_gaps` 条目。

```yaml
coverage_gaps:
  - gap_id: KERNEL-RECOVERY-GAP-P1-10-02-01
    affected_violation_probe_ids:
      - KERNEL-PROBE-P1-10-02-V06
    affected_recovery_probe_ids:
      - KERNEL-PROBE-P1-10-02-R02
    appendix_predecessor_text: "stale-generation denial"
    reason: "The appendix does not bind the prose predecessor to one exact probe identity."
    owner: kernel-contract
    closure_plan: "Approve the exact predecessor mapping, then add a regression fixture."
```

规则：

- gap 中的 probe ID 必须属于同一 atom；
- 一个 violation 不得同时由 exact binding 和 coverage gap 声称同一关系；
- earlier-recovery predecessor 只有附录或批准设计明确声明时才允许；
- recovery graph 必须无环；
- validator 必须证明所有 violation/recovery obligations 已被 binding 或 gap 记账；
- 任一 recovery coverage gap 存在时，atom、family、proof 和 cutover 都不能 green。

逐 ID 复审确认以下 11 个 atoms 至少有一个 recovery mapping gap。根合同不得保留生成器
补出的 all-V 映射，未被附录唯一绑定的 obligations 必须进入 `coverage_gaps`：

```text
KERNEL-INV-P0-02-03-ATTEMPT-SCOPED-CREDENTIAL-LEASE
KERNEL-INV-P0-03-03-SCOPED-GITHUB-PUSH-AND-DRAFT-PR-MUTATION
KERNEL-INV-P0-04-02-DURABLE-EXACT-SHA-AUTHORIZATION
KERNEL-INV-P0-04-03-GITHUB-MERGE-EFFECT-AND-CONFIRMATION
KERNEL-INV-P1-08-03
KERNEL-INV-P1-08-04
KERNEL-INV-P1-09-01
KERNEL-INV-P1-09-03
KERNEL-INV-P1-10-01
KERNEL-INV-P1-10-02
KERNEL-INV-P1-11-03
```

另外两个 atoms 没有 coverage gap，但首次生成器加入了附录未授权的 earlier-recovery
predecessor chain：

```text
KERNEL-INV-P1-10-03
KERNEL-INV-P1-11-04
```

这两个 atoms 必须保留附录逐 V 明示的 exact bindings，只删除 invented earlier-R
predecessors，并保持 `coverage_gaps: []`。不得为了维持“13”这个审计数字伪造 gap。

## 5. Retired 与 replacement 信息保真

### 5.1 Retired

retired absence probe 必须保存：

```yaml
- probe_id: KERNEL-PROBE-P1-08-01-A01
  scenario: absence
  assertion: "packages/engine/hooks/stop-dev.sh must remain absent."
  expected_outcome: absent
  expectation_authority:
    kind: appendix_explicit
    normative_ref: docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p1.md
```

四项 absence proof 在 A2-0 仍为 `unverified`。保存 assertion 不等于完成 absence proof，
也不能产生 green。

### 5.2 Intentional replacement

replacement 继续禁止 active authority fields，但必须允许在 replacement block 内保存：

```yaml
replacement:
  forbidden_legacy_authority: "The dynamic prompt/Stop-loop has no merge, quality-verdict, timeout-auto-PASS, or tmux-self-kill authority."
  replacement_behavior: "Harness Controller owns local execution liveness; Kernel Global Controller owns cross-Harness closure."
  rationale: "Durable Attempt/controller reconciliation replaces interactive-session liveness authority."
  legacy_evidence:
    - kind: code
      ref: repository/relative/path
      audited_at_sha: f16f2a76eef592c0e7b896bb58940f5e6231c306
```

该 evidence 只证明旧 authority/替代决策的历史事实，不是 live atomic proof。

## 6. Validator 与投影

schema `1.1.0` 尚未发布，因此直接修正，不再增加一个过渡 runtime schema version。

validator 必须新增并区分：

```text
probe_outcome_contract_invalid
recovery_binding_authority_invalid
recovery_coverage_gap_invalid
replacement_legacy_evidence_invalid
```

返回 metrics 至少增加：

```yaml
probe_outcome_authority:
  appendix_explicit: 0
  design_derived: 0
  coverage_gap: 0
recovery_mapping:
  exact_binding_count: 0
  derived_binding_count: 0
  coverage_gap_count: 0
```

投影规则：

- appendix-exact 或合法 derived 只表示 schema fact；
- `coverage_gap` 强制 atom effective status 为 `gap`；
- retired 仍投影 `retired/na`，absence freshness 独立为红；
- A2-0 没有 receipt v2 verifier，所有 proof-required atoms 仍为 gap；
- `schema_valid=true` 可以与 `proof_complete=false`、`atomic_cutover_ready=false` 同时成立。

## 7. 实施和验收顺序

1. 先扩展 atomic RED tests，复现 11 个 outcome 压平、11-atom recovery gaps、
   2-atom earlier-recovery chain invention、retired assertion 丢失和 replacement
   evidence 丢失；
2. 修改 validator，使 binding 与 gap 都能被精确表达且 fail-closed；
3. 更新根 inventory 生成器，删除 invented mappings，写入 explicit gaps；
4. 对照三份 appendix 逐 ID、assertion、outcome、binding、gap 复审；
5. 删除所有临时脚本；
6. 只有以下结果可接受：

```text
schema_valid = true
proof_complete = false
atomic_cutover_ready = false
family_cells = 0/99 proven
```

本补充不实现 receipt v2、typed production ports、live drills、merge 或 deployment。
