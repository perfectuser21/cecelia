# Kernel Atomic Behavior Contract A2-0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已批准的 43-atom / 446-probe P0/P1 基线落入唯一根合同，并让 validator、projector、report 和 CI 在保持 99 个 family cells、当前 0/99 的前提下区分 schema 合法与 proof 完成。

**Architecture:** 根 `regression-contract.yaml` 仍是唯一运行期 SSOT；新增聚焦的 atomic contract validator，既有 family validator 负责组合与向后兼容。schema `1.0.0` 只允许旧 family 合同，schema `1.1.0` 一次性要求完整 atomic inventory；A2-0 不实现 receipt v2，也不能把任何 atom 或 family cell 改绿。

**Tech Stack:** Node.js ESM、Vitest 1.6、js-yaml、YAML、Markdown/JSON、现有 Kernel equivalence CLI。

---

## 范围边界

本计划只实施批准设计中的 A2-0：

- 根合同 schema `1.0.0` / `1.1.0` 严格双读；
- 43 atoms、446 probes、四种 classification；
- schema 与 proof 两个正交结果；
- atom → family → S0-S12 × 11 要素投影；
- 确定性 JSON/Markdown 报告；
- root-only SSOT、禁止 `behavior_ledger`；
- release/cutover gate 继续 fail-closed，保持 0/99。

以下内容明确不在本计划中：

- `kernel-equivalence-grant/v2`；
- atom effect receipt、cell aggregate v2、bundle v2 的签发和验签；
- production ports、resource saga、真实 live drills；
- push、PR、merge、staging 或 deployment。

receipt v2 属于后续 A2-1。A2-0 只要求：v1 family receipt 永远不能制造 atomic green；
任何声称 atomic proof 的配置在 v2 verifier 尚未落地时保持 gap。

## File map

- `regression-contract.yaml`
  - 唯一 behavior family、atomic inventory、probe definitions 和 proof requirement SSOT。
- `packages/brain/src/lib/kernel-equivalence-axes.js`
  - 锁定 S0-S12 canonical name、11 dimensions、Provider/scenario。
- `packages/brain/src/lib/kernel-equivalence-atomic-contract.js`
  - 新增；只负责 schema version、atomic identity/count/classification/axes/scenario 结构校验。
- `packages/brain/src/lib/kernel-behavior-equivalence.js`
  - 组合 legacy family validator 与 atomic validator；计算 family effective status、projection 和 report model。
- `packages/brain/src/lib/kernel-equivalence-drills.js`
  - 保持 11 descriptors / 99 cells；为报告暴露 atomic requirement counts，不执行 receipt v2。
- `packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js`
  - 新增；atomic schema 的正反例。
- `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`
  - schema/proof 分离、family aggregation、projection/report 回归。
- `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`
  - 11/99 不变量和 atomic requirement counts。
- `packages/brain/src/lib/__tests__/kernel-equivalence-drill-cli.test.js`
  - informational check 与 fail-closed gate。
- `packages/quality/__tests__/regression-contract.test.js`
  - 根合同 exact counts、canonical steps、root-only inventory。
- `packages/quality/__tests__/ci-core-regression.test.js`
  - 保证无条件 core regression 使用 schema check，而不是尚未满足的 cutover gate。
- `scripts/ci/check-kernel-behavior-equivalence.mjs`
  - root-only SSOT 和 forbidden ledger 扫描；输出 schema/proof metrics。
- `packages/brain/src/lib/kernel-equivalence-repository-policy.js`
  - 新增；可测试的 package-contract discovery 与 SQL ledger policy。
- `packages/brain/src/lib/__tests__/kernel-equivalence-repository-policy.test.js`
  - 新增；用临时目录验证 second SSOT 和 DDL 变体。
- `scripts/ci/run-kernel-equivalence-drill.mjs`
  - check/gate 输出 atomic completeness，gate 同时要求 schema 和 proof。
- `docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md`
  - 重新生成；必须诚实显示 43 classified、42 proof-required、0 atomic proof、0/99。
- `packages/brain/DEFINITION.md`、`DEFINITION.md`
  - 记录 A2-0 边界和 0/99 状态。
- `packages/brain/package.json`、`packages/brain/package-lock.json`、`package-lock.json`、`.brain-versions`
  - Brain patch version 同步。

## Task 1: Atomic schema RED

**Files:**

- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js`
- Test fixture imports: `packages/brain/src/lib/kernel-equivalence-axes.js`

- [ ] **Step 1: 写 schema version 的 failing tests**

测试定义 `legacySection()` 和 `atomicSection()` 两个最小 fixture。`atomicSection()` 使用一个
family fixture 做局部错误测试，但把全局 expected counts 作为可注入 option，避免每个单测
复制 43 atoms。

```js
import { describe, expect, it } from 'vitest';
import {
  validateAtomicContract,
} from '../kernel-equivalence-atomic-contract.js';

describe('validateAtomicContract schema versions', () => {
  it('accepts pure v1.0 as legacy-only and never marks atomic cutover ready', () => {
    const result = validateAtomicContract({
      schema_version: '1.0.0',
      required_behavior_count: 11,
      behaviors: [],
    });
    expect(result).toMatchObject({
      schema_valid: true,
      atomic_contract_present: false,
      atomic_cutover_ready: false,
    });
  });

  it('rejects atomic fields in v1.0 and rejects unknown versions', () => {
    const mixed = validateAtomicContract({
      schema_version: '1.0.0',
      required_atomic_invariant_count: 43,
      behaviors: [],
    });
    expect(mixed.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'atomic_fields_forbidden_in_v1' }),
    ]));

    const unknown = validateAtomicContract({
      schema_version: '2.0.0',
      behaviors: [],
    });
    expect(unknown.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'behavior_equivalence_schema_unsupported' }),
    ]));
  });
});
```

- [ ] **Step 2: 写 v1.1 count、identity 和 prefix 的 failing tests**

覆盖：

- 11 unique families；
- 43 unique atom IDs；
- 42 proof-required atoms；
- 446 unique probe IDs；
- 442 proof-required probes；
- 4 retired absence probes；
- family count 与真实数组派生值一致；
- atom ID priority/family prefix 与父 family 一致；
- probe ID 只能属于声明它的 atom；
- duplicate atom/probe、断号或错误 family prefix fail-closed。

测试 finding codes 固定为：

```js
[
  'atomic_global_count_mismatch',
  'atomic_family_count_mismatch',
  'atomic_invariant_id_duplicate',
  'atomic_invariant_prefix_invalid',
  'atomic_probe_id_duplicate',
  'atomic_probe_prefix_invalid',
  'atomic_probe_count_mismatch',
]
```

- [ ] **Step 3: 写 legacy evidence replayability 的 failing tests**

`legacy_evidence` 在 A2-0 只接受 repository-replayable 结构：

```js
{
  kind: 'code' | 'test' | 'contract' | 'history',
  ref: 'repository/relative/path-or-history-ref',
  audited_at_sha: '40-or-64-lowercase-hex',
}
```

设计允许未来加入 signed `runtime_audit`，但 A2-0 没有 audit trust registry、canonical
signed payload 或 verifier，所以任何 `kind: runtime_audit` 一律 finding
`runtime_audit_verifier_unavailable`，不能仅凭 `auditor_identity + signature` 字符串接受。
四个锁定 digest 继续保留在批准设计中，直到独立 runtime-audit signer/verifier 交付后
才能进入 root `legacy_evidence`。

测试拒绝：

- `~/.claude/settings.json`；
- `/Users/alice/.claude/settings.json` 等绝对路径；
- `../` 越界；
- repo ref 缺 `audited_at_sha`；
- 任意 runtime audit object/ref，即使看起来包含 signature；
- `payload`、`content`、`secret`、`credential`、`token`、`private_key` 等原文字段。

A2-0 根合同不得把 appendix 的裸 `machine audit:` 文本机械复制为 evidence。没有 signed
runtime audit 的机器事实只能留在 gap/drift observation，不能用于制造 active proof。

- [ ] **Step 4: 写 classification 专属块互斥的 failing tests**

精确规则：

```text
active_required:
  legacy_behavior + legacy_evidence + unified_constructs + gap
drifted_required_gap:
  active fields + drift.expected/observed/evidence/owner/closure_plan
intentional_replacement:
  replacement.forbidden_legacy_authority/replacement_behavior/rationale
retired:
  retirement.decision_ref/rationale/absence_proof
  receipt_requirements.policy = not_required
```

四种 classification 的专属块互斥；`classification` 与 `proof_status` 分开。测试
`proof_status: proven` 不得改写 classification。

- [ ] **Step 5: 写 axes 和 scenario plan 的 failing tests**

覆盖：

- 每个 non-retired atom 的 steps/dimensions 是父 family 非空子集；
- non-retired atom 并集必须精确覆盖父 axes；
- proof-required atom providers 精确为 Claude/Codex/Grok；
- normal/violation/recovery 精确存在；
- normal 至少一个 probe、violation 至少一个 probe；
- recovery replay 或专用 probe 必须引用同 atom violation predecessor；
- 每个 atom 恰好一个非空 scalar `single_effect_owner_seam`，不得用数组或多个 owner；
- proof-required atom 的 `receipt_requirements.scenarios` 精确包含
  normal/violation/recovery，每项都有 canonical `expected_outcome` 和 `effect_code`；
- recovery 精确要求 `predecessor_scenario: violation`，且
  `predecessor_binding.exact_receipt_id_required/same_provider/same_case/`
  `same_artifact_sha/same_resource_generation` 五项全为 `true`；
- retired 只允许 absence probes，不允许伪造 3×3。

固定相应 finding codes：

```js
[
  'atomic_single_effect_owner_seam_invalid',
  'atomic_scenario_requirement_invalid',
  'atomic_recovery_predecessor_binding_invalid',
]
```

- [ ] **Step 6: 运行 RED**

Run:

```bash
cd packages/brain
npx vitest run src/lib/__tests__/kernel-equivalence-atomic-contract.test.js
```

Expected: FAIL，原因是 `kernel-equivalence-atomic-contract.js` 不存在。

- [ ] **Step 7: 提交 RED**

```bash
git add packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js
git commit -m "test(kernel): specify atomic equivalence schema"
```

## Task 2: Atomic schema GREEN

**Files:**

- Create: `packages/brain/src/lib/kernel-equivalence-atomic-contract.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-axes.js`
- Test: `packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js`

- [ ] **Step 1: 锁定 canonical constants**

在 axes module 新增并 freeze：

```js
export const GOLDEN_PATH_STEP_CATALOG = Object.freeze([
  { id: 'S0', name: 'Task Born' },
  { id: 'S1', name: 'Intent / PrepPRD' },
  { id: 'S2', name: 'Planner' },
  { id: 'S3', name: 'Contract GAN' },
  { id: 'S4', name: 'Generator' },
  { id: 'S5', name: 'CI' },
  { id: 'S6', name: 'Evaluator' },
  { id: 'S7', name: 'Independent Judge' },
  { id: 'S8', name: 'Risk-based Human Review' },
  { id: 'S9', name: 'Merge' },
  { id: 'S10', name: 'Staging' },
  { id: 'S11', name: 'Production' },
  { id: 'S12', name: 'Report / Learning / Complete' },
]);

export const ATOMIC_CONTRACT_COUNTS = Object.freeze({
  behavior_count: 11,
  atomic_invariant_count: 43,
  proof_required_atomic_invariant_count: 42,
  probe_definition_count: 446,
  proof_required_probe_definition_count: 442,
  provider_probe_assertion_count: 1326,
  retired_absence_probe_count: 4,
});
```

`GOLDEN_PATH_STEPS` 从 catalog 派生，不保留第二份手写 S0-S12。
同时新增 frozen `FAMILY_CANONICAL_AXES`，逐 family 保存批准设计 §3.4 的 exact steps 和
dimensions；validator 用它校验根合同，不能只验证 atom 与错误父 axes 自洽。

- [ ] **Step 2: 实现纯 atomic validator**

导出 API：

```js
export function validateAtomicContract(section) {
  return {
    schema_version: section?.schema_version ?? null,
    schema_valid: findings.length === 0,
    atomic_contract_present: section?.schema_version === '1.1.0',
    atomic_cutover_ready: false,
    metrics,
    families,
    findings,
  };
}
```

实现只读、无 DB、无文件访问。所有 count 从真实数组派生；contract 内声明值只用于对账。
finding 结构沿用 `{severity, behavior_id, code, path, message}`。

- [ ] **Step 3: 实现 evidence 和 classification 校验**

实现 Step 1 tests 锁定的 repository-relative evidence。`legacy_evidence` 中任何绝对
路径、home-relative path、未绑定 SHA 的 repo ref 或任何 runtime audit 都是 schema
finding；runtime audit 在未来拥有 trust-bound verifier 前不允许进入 evidence。
classification 专属块必须 exact 且互斥。

每个 atom 的 `single_effect_owner_seam` 必须是一个非空 canonical identifier scalar。
proof-required atom 必须完整声明三种 scenario 的 exact expected outcome/effect code 和
五项 recovery predecessor binding；缺字段、false、额外 scenario 或多个 owner 一律
schema finding。retired atom 不允许这些 3×3 receipt requirements。

- [ ] **Step 4: 明确 A2-0 proof 行为**

`validateAtomicContract()` 只验证 proof 配置：

- `proof_status: gap` 且 receipt 未配置：schema 可合法；
- proof-required atom 声称 `proven`：finding `atomic_receipt_v2_verifier_unavailable`；
- v1 `kernel-equivalence-execution-grant/v1`、
  `kernel-equivalence-effect-receipt/v1`、
  `kernel-equivalence-receipt-bundle/v1`、family bundle 或非空字符串不得满足 atom proof；
- `proof_status: gap` 但配置任何 receipt material，包括看似 v2 的 object/ref，同样 finding
  `atomic_receipt_v2_verifier_unavailable`；
- retired 只允许 `proof_status: not_applicable`，并以 classification/retirement decision
  投影 `effective_status: retired`、cell `na`；但四项 absence proof 单独保持
  `unverified`，因此 family/cutover 不得变绿；
- public A2-0 validator 对全部 proof-required atom 强制 effective `gap`，对 retired
  absence 强制 `unverified`。

- [ ] **Step 5: 运行 GREEN**

```bash
cd packages/brain
npx vitest run src/lib/__tests__/kernel-equivalence-atomic-contract.test.js
```

Expected: PASS。

- [ ] **Step 6: 运行相邻 axes tests**

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-atomic-contract.test.js \
  src/lib/__tests__/kernel-behavior-equivalence.test.js \
  src/lib/__tests__/kernel-equivalence-drills.test.js
```

Expected: PASS；现有 v1.0 tests 不回归。

- [ ] **Step 7: 提交 GREEN**

```bash
git add \
  packages/brain/src/lib/kernel-equivalence-axes.js \
  packages/brain/src/lib/kernel-equivalence-atomic-contract.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js
git commit -m "feat(kernel): validate atomic equivalence schema"
```

## Task 3: Root 1.1 inventory RED

**Files:**

- Modify: `packages/quality/__tests__/regression-contract.test.js`
- Test input: `regression-contract.yaml`

- [ ] **Step 1: 扩展 root contract test**

新增测试必须直接读取仓库根 `regression-contract.yaml`，断言：

```js
expect(section.schema_version).toBe('1.1.0');
expect(section.required_behavior_count).toBe(11);
expect(section.required_atomic_invariant_count).toBe(43);
expect(section.proof_required_atomic_invariant_count).toBe(42);
expect(section.required_probe_definition_count).toBe(446);
expect(section.proof_required_probe_definition_count).toBe(442);
expect(section.required_provider_probe_assertion_count).toBe(1326);
expect(section.required_retired_absence_probe_count).toBe(4);
```

从 `behaviors[].atomic_invariants[]` 派生并断言：

```js
expect(new Set(atomIds).size).toBe(43);
expect(new Set(probeIds).size).toBe(446);
expect(classificationCounts).toEqual({
  active_required: 17,
  drifted_required_gap: 23,
  intentional_replacement: 2,
  retired: 1,
});
```

并断言 journey exact name、11 family atom/probe totals：

```text
P0-01 4/31   P0-02 3/29   P0-03 4/42   P0-04 4/40
P0-05 3/25   P0-06 2/34   P0-07 5/57
P1-08 5/44   P1-09 5/71   P1-10 4/40   P1-11 4/33
```

- [ ] **Step 2: 锁定 11 family exact canonical axes**

测试逐 family 深比较，不只检查父子覆盖：

```text
P0-01 steps=S4
      dimensions=nfr,invariant,checkpoint,failure_semantics,effect_confirmation,adversarial_surface
P0-02 steps=S0,S4,S12
      dimensions=nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness
P0-03 steps=S4,S5,S9
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness
P0-04 steps=S5,S6,S7,S8,S9
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness,axis_alignment
P0-05 steps=S5,S6,S7,S9
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness,axis_alignment
P0-06 steps=S8,S9
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness,axis_alignment
P0-07 steps=S9,S10,S11,S12
      dimensions=fr,nfr,invariant,checkpoint,freshness,death_alert,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness,axis_alignment
P1-08 steps=S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12
      dimensions=nfr,invariant,checkpoint,freshness,death_alert,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness
P1-09 steps=S1,S2,S3,S4,S5,S6
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,adversarial_surface,axis_alignment
P1-10 steps=S0,S2,S3,S4,S5,S6,S7,S12
      dimensions=fr,nfr,invariant,checkpoint,freshness,death_alert,failure_semantics,effect_confirmation,adversarial_surface,ledger_freshness,axis_alignment
P1-11 steps=S1,S6,S7,S8,S9,S10,S11,S12
      dimensions=fr,nfr,invariant,checkpoint,freshness,failure_semantics,effect_confirmation,ledger_freshness,axis_alignment
```

同一 oracle 还由 atomic validator test 构造“父子一起改成错误但自洽 axes”的 fixture，
断言 finding `atomic_family_canonical_axes_mismatch`。

- [ ] **Step 3: 写 root-only negative test**

临时构造 package-level contract path 列表，断言只有仓库根允许顶层
`behavior_equivalence`；`packages/engine/regression-contract.yaml` 只能保留 Engine 自身
regression 内容。

- [ ] **Step 4: 运行 RED**

```bash
cd packages/quality
npx vitest run __tests__/regression-contract.test.js
```

Expected: FAIL；当前根合同仍是 schema `1.0.0`、无 43-atom inventory。

- [ ] **Step 5: 提交 RED**

```bash
git add packages/quality/__tests__/regression-contract.test.js
git commit -m "test(kernel): require root atomic inventory"
```

## Task 4: Root 1.1 inventory GREEN

**Files:**

- Modify: `regression-contract.yaml`
- Source of exact identities: `docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p0-premerge.md`
- Source of exact identities: `docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p0-evaluation-release.md`
- Source of exact identities: `docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p1.md`

- [ ] **Step 1: 一次性升级 schema 和全局 counts**

设置：

```yaml
schema_version: "1.1.0"
contract_version: "kernel-atomic-equivalence-2026-07-29"
required_behavior_count: 11
required_atomic_invariant_count: 43
proof_required_atomic_invariant_count: 42
required_probe_definition_count: 446
proof_required_probe_definition_count: 442
required_provider_probe_assertion_count: 1326
required_retired_absence_probe_count: 4
```

不改 trust registry key，不添加 synthetic key，不添加 receipt。

- [ ] **Step 2: 恢复 canonical S0-S12 names**

根合同 journey names 必须逐字等于 `GOLDEN_PATH_STEP_CATALOG`；workspace/controller/attempt
仍是跨 Step 资源，不再占用 S2/S3。

- [ ] **Step 3: 写入 43 atoms 和 446 probes**

以三份批准 appendix 中的完整 ID、owner/seam、classification、legacy truth/evidence、
steps/dimensions、probe definitions、scenario mapping、recovery predecessor 为精确来源。
不得自行缩写带 slug 的 atom ID，不得重新编号 probe。

每个 atom 必须用 scalar `single_effect_owner_seam` 写入 appendix 的唯一 owner/seam。
每个 proof-required atom 的 `receipt_requirements.scenarios` 必须把 appendix 的 canonical
scenario assertions 归一为 exact `expected_outcome`/`effect_code`，并完整写入：

```yaml
recovery:
  predecessor_scenario: violation
  predecessor_binding:
    exact_receipt_id_required: true
    same_provider: true
    same_case: true
    same_artifact_sha: true
    same_resource_generation: true
```

不能用自由文本、默认值或 family owner 替代 atom owner/seam 与 recovery binding。

appendix 中的 repository evidence 必须转成结构化
`{kind, ref, audited_at_sha}`；无另行 snapshot 声明时绑定已审基线
`f16f2a76eef592c0e7b896bb58940f5e6231c306`。裸 `machine audit:`、
`~/.claude/settings.json` 或绝对路径不得进入 `legacy_evidence`；这些机器观察在 signed
runtime-audit artifact 存在前只能保留在 `drift.observed`/gap 文本，不能作为可重放证据。

每个 proof-required atom 当前统一保持：

```yaml
proof_status: gap
receipt_requirements:
  policy: required_3x3
  providers: [claude, codex, grok]
```

retired atom `KERNEL-INV-P1-08-01` 使用：

```yaml
proof_status: not_applicable
receipt_requirements:
  policy: not_required
retirement:
  decision_ref: "ce06281543458e3f14ae68ca57fede2f6b5d4194/#3086"
  absence_proof:
    required_probe_ids:
      - KERNEL-PROBE-P1-08-01-A01
      - KERNEL-PROBE-P1-08-01-A02
      - KERNEL-PROBE-P1-08-01-A03
      - KERNEL-PROBE-P1-08-01-A04
```

不填 `verified_at`、signature 或假 receipt；当前 proof 必须保持 incomplete。

- [ ] **Step 4: 更新 11 family axes**

父 family steps/dimensions 精确使用批准设计 §3.4。validator 必须证明每个 non-retired atom
是父集子集，且并集精确覆盖父 axes。

- [ ] **Step 5: 保持现有 family drill descriptors 和 99 matrices**

既有 `drill`、`proof_matrix`、trust registry 和 bundle chain 不删除。A2-0 不把 family
v1 receipt 投影成 atom proof，不把 signer status 改为 available。

- [ ] **Step 6: 运行 GREEN**

```bash
cd packages/quality
npx vitest run __tests__/regression-contract.test.js

cd ../brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-atomic-contract.test.js \
  src/lib/__tests__/kernel-behavior-equivalence.test.js

cd ../..
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { validateAtomicContract } from './packages/brain/src/lib/kernel-equivalence-atomic-contract.js';
const contract = load(readFileSync('./regression-contract.yaml', 'utf8'));
const result = validateAtomicContract(contract.behavior_equivalence);
if (!result.schema_valid) {
  console.error(JSON.stringify(result.findings, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result.metrics));
NODE
```

Expected: PASS；真实根合同而非缩小 fixture 必须通过完整 classification、recovery、axes、
evidence 和 count validator。

- [ ] **Step 7: 运行 count self-check**

```bash
node scripts/ci/check-kernel-behavior-equivalence.mjs --format=json
```

Expected: schema contract 可读取；在 Task 5 集成前 proof 仍不得完成。

- [ ] **Step 8: 提交 inventory**

```bash
git add regression-contract.yaml
git commit -m "feat(kernel): add atomic behavior inventory"
```

## Task 5: Validator aggregation RED/GREEN

**Files:**

- Modify: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js`
- Modify: `packages/brain/src/lib/kernel-behavior-equivalence.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-atomic-contract.js`

- [ ] **Step 1: 写 schema/proof 正交结果 RED**

新增测试：

```js
expect(validateBehaviorEquivalence(v11GapContract, { now: NOW })).toMatchObject({
  valid: true,
  schema_valid: true,
  proof_complete: false,
  atomic_cutover_ready: false,
  legacy_verified_family_receipt_count: 0,
  atomic_proven_family_cell_count: 0,
});
```

另测：

- v1.0 trusted family proof 可增加 `legacy_verified_family_receipt_count`，但
  `proof_complete=false`；
- v1.1 即使拥有 99 个有效 v1 family receipts，仍必须
  `atomic_proven_family_cell_count=0`、atomic family cells 0/99；
- v1.1 配置 v1 receipt、看似 v2 的 object/ref 或任意未验证 receipt material 时
  atom 保持 gap 且 `schema_valid=false`；
- invalid schema 与 invalid configured receipt 都 `schema_valid=false`；
- `result.valid === result.schema_valid` 对合法和非法合同恒成立；
- gap 本身不是 schema finding。

- [ ] **Step 2: 写纯 aggregation 状态机 RED**

新增纯函数 `deriveFamilyEffectiveStatus(verifiedAtomStatuses)`。它只接收未来 verifier 已经
验证过的 effective status，不读 contract 自报字段，也不验证 receipt：

```text
any proof-required atom gap -> family gap
all proof-required proven + retired absence current -> family proven
all non-retired replacement -> family intentional_replacement
mixed active/drifted/replacement all proven -> family proven
retired with valid absence -> atom not_applicable / projection na
```

用人工构造的“已验证状态输入”测试状态机，确保单个 replacement 不会把整族标为
replacement。另对 public A2-0 validator 写回归：contract 中自报 `proof_status: proven`
或伪造 absence material 都不能到达 family positive path；proof-required effective
status 一律 gap。合法 retired atom 投影 `retired/na`，但
`retired_absence_complete=false`，所以 family 和 cutover 仍不能 green。

- [ ] **Step 3: 写 projection RED**

`projectJourneyCells()` 输出仍使用既有 `journey_step_links` vocabulary，但增加：

```js
{
  atom_ids: ['KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION'],
  atom_statuses: ['gap'],
  cell_status: 'red',
  write_database: false,
}
```

同 family/step/dimension 采用最差状态；不得为 43 atoms 创建新顶层 journey。

- [ ] **Step 4: 运行 RED**

```bash
cd packages/brain
npx vitest run src/lib/__tests__/kernel-behavior-equivalence.test.js
```

Expected: FAIL，缺 `schema_valid`、`proof_complete` 和 atomic aggregation。

- [ ] **Step 5: 实现组合 validator**

`validateBehaviorEquivalence()`：

```js
const atomic = validateAtomicContract(section);
const schemaValid = legacyFindings.length === 0 && atomic.schema_valid;
const proofComplete =
  section.schema_version === '1.1.0'
  && schemaValid
  && atomic.atomic_cutover_ready
  && normalizedBehaviors.every((item) => item.effective_status !== 'gap');

return {
  ...existingResult,
  valid: schemaValid,
  schema_valid: schemaValid,
  proof_complete: proofComplete,
  atomic_cutover_ready: atomic.atomic_cutover_ready,
  atomic_metrics: atomic.metrics,
  legacy_verified_family_receipt_count:
    verificationMetrics.verifiedProofCellCount,
  atomic_proven_family_cell_count: 0,
};
```

旧结果必须先 spread，再最后写入 atomic 字段，防止旧 `valid` 覆盖兼容 alias。
`valid` 暂时作为 `schema_valid` 的兼容 alias；release/cutover gate 禁止只读 `valid`。

- [ ] **Step 6: 实现 atom/family projection**

不要在 projector 中读取文件或 DB。family effective status 必须从 atom 计算，不能信任
family 自报；v1.0 继续走旧 projection。A2-0 public path 的 proof-required atomic
projection 只能 red/pending；retired 可投影 na，但 absence completeness 是独立红门。
任何 v1 receipt 或 contract 自报都不能产生 green。

- [ ] **Step 7: 运行 GREEN 和相邻 tests**

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-atomic-contract.test.js \
  src/lib/__tests__/kernel-behavior-equivalence.test.js \
  src/lib/__tests__/kernel-equivalence-drills.test.js
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add \
  packages/brain/src/lib/kernel-equivalence-atomic-contract.js \
  packages/brain/src/lib/kernel-behavior-equivalence.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-atomic-contract.test.js \
  packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js
git commit -m "feat(kernel): aggregate atomic equivalence status"
```

## Task 6: Report and drill metrics RED/GREEN

**Files:**

- Modify: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drill-cli.test.js`
- Modify: `packages/brain/src/lib/kernel-behavior-equivalence.js`
- Modify: `packages/brain/src/lib/kernel-equivalence-drills.js`

- [ ] **Step 1: 写 report RED**

`buildEquivalenceReport()` 必须输出：

```js
{
  report_version: '1.1.0',
  schema_valid: true,
  proof_complete: false,
  atomic_summary: {
    classified: 43,
    proof_required: 42,
    probe_definitions: 446,
    proof_required_probe_definitions: 442,
    proven: 0,
    gap: 42,
    classification_counts: {
      active_required: 17,
      drifted_required_gap: 23,
      intentional_replacement: 2,
      retired: 1,
    },
    retired_absence_fresh: 0,
    retired_absence_required: 4,
    atom_scenario_required: 378,
    provider_probe_required: 1326,
    provider_probe_proven: 0,
  },
  provider_matrix: {
    required_cells: 99,
    legacy_verified_family_receipts: 0,
    atomic_proven_family_cells: 0,
  },
  cell_atomic_coverage: [{
    cell_id: 'KERNEL-P0-01-BRANCH-PROTECTION::claude::normal',
    expected_invariant_ids: [
      'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION',
      'KERNEL-INV-P0-01-02-MAIN-CHECKOUT-MUTATION-DENIAL',
      'KERNEL-INV-P0-01-03-COMMIT-ADMISSION',
      'KERNEL-INV-P0-01-04-GUARD-SELF-PROTECTION-AND-PATH-CONTAINMENT',
    ],
    configured_invariant_ids: [],
    live_proven_invariant_ids: [],
    missing_invariant_ids: [
      'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION',
      'KERNEL-INV-P0-01-02-MAIN-CHECKOUT-MUTATION-DENIAL',
      'KERNEL-INV-P0-01-03-COMMIT-ADMISSION',
      'KERNEL-INV-P0-01-04-GUARD-SELF-PROTECTION-AND-PATH-CONTAINMENT',
    ],
    expected_probe_ids: [
      'KERNEL-PROBE-P0-01-01-001',
      'KERNEL-PROBE-P0-01-02-007',
      'KERNEL-PROBE-P0-01-03-001',
      'KERNEL-PROBE-P0-01-04-006',
    ],
    configured_probe_ids: [],
    live_proven_probe_ids: [],
    missing_probe_ids: [
      'KERNEL-PROBE-P0-01-01-001',
      'KERNEL-PROBE-P0-01-02-007',
      'KERNEL-PROBE-P0-01-03-001',
      'KERNEL-PROBE-P0-01-04-006',
    ],
  }],
}
```

上面给出第一个 cell 的精确期望；其余 98 个 cell 必须从真实 root canonical scenario
plan 派生并按 ID 排序，不允许手写第二份 inventory。99 个 cell 每个都必须输出四级区分：

```text
family cell present
atom requirement declared
atom receipt configured
atom live effect proven
```

A2-0 初始每个 cell 的 configured/live arrays 都为空，missing 等于 expected。现有 family
report 字段保留，避免消费者静默断裂；legacy verified receipt 只能进入 legacy 字段。

报告还必须为每个 atom 输出：

```js
{
  invariant_id,
  classification,
  proof_status,
  effective_status,
  artifact_sha: null,
  receipt_v2_identity: null,
  verified_at: null,
  expires_at: null,
  replacement_forbidden_authority_status: 'unverified' | null,
  retired_absence_probe_statuses: [],
}
```

replacement 未验证 forbidden legacy authority、retired 四项 absence 未验证，都必须产生
明确 finding/coverage gap，不能只出总数。

- [ ] **Step 2: 写 deterministic Markdown RED**

Markdown 必须明确显示：

- 43/43 classified；
- 42 proof-required；
- 446 probe definitions / 442 proof-required probes；
- classification 17 active / 23 drifted gap / 2 replacement / 1 retired；
- 0/378 atom-scenario；
- 0/1326 provider-probe；
- 0/4 retired absence；
- 0/99 family cells；
- 11 个 family 的 atom gap；
- “v1 family receipt 不是 atomic proof”。
- 每个 99-cell 的 expected/configured/live/missing invariant 与 probe IDs；
- replacement forbidden-authority、retired absence、atom freshness/artifact/receipt identity。

- [ ] **Step 3: 写 deterministic JSON/Markdown RED**

family、atom、probe、provider、scenario 全部使用 canonical stable sort。对同一 validation
连续构建两次报告：

```js
const first = buildEquivalenceReport(validation, { evaluatedAt: NOW_ISO });
const second = buildEquivalenceReport(validation, { evaluatedAt: NOW_ISO });
expect(JSON.stringify(second)).toBe(JSON.stringify(first));
expect(formatEquivalenceMarkdown(second)).toBe(formatEquivalenceMarkdown(first));
expect(first.cell_atomic_coverage).toHaveLength(99);
```

CLI test 连续运行两次 `--check --format=json`，断言 stdout byte-for-byte 相同。

- [ ] **Step 4: 写 drill plan RED**

`compileDrillPlan()` 继续断言：

```js
expect(plan.behavior_count).toBe(11);
expect(plan.cells).toHaveLength(99);
expect(plan.atomic_requirements).toMatchObject({
  atom_count: 43,
  proof_required_atom_count: 42,
  probe_count: 446,
  provider_probe_assertion_count: 1326,
});
```

它只编译 requirements，不创建 378 个新顶层 cells，也不执行 v2 receipt。

- [ ] **Step 5: 实现并运行 GREEN**

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-behavior-equivalence.test.js \
  src/lib/__tests__/kernel-equivalence-drills.test.js
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add \
  packages/brain/src/lib/kernel-behavior-equivalence.js \
  packages/brain/src/lib/kernel-equivalence-drills.js \
  packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-drill-cli.test.js
git commit -m "feat(kernel): report atomic equivalence progress"
```

## Task 7: CLI, root-only SSOT, and cutover gate RED/GREEN

**Files:**

- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drill-cli.test.js`
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-repository-policy.test.js`
- Create: `packages/brain/src/lib/kernel-equivalence-repository-policy.js`
- Modify: `packages/quality/__tests__/ci-core-regression.test.js`
- Create: `.github/workflows/kernel-equivalence-cutover.yml`
- Modify: `regression-contract.yaml`
- Modify: `scripts/ci/check-kernel-behavior-equivalence.mjs`
- Modify: `scripts/ci/run-kernel-equivalence-drill.mjs`
- Modify: `docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md`

- [ ] **Step 1: 写 CLI RED**

`--check` 仍是 informational，exit 0，但输出必须包含：

```js
{
  contract_valid: true,
  schema_valid: true,
  proof_complete: false,
  atomic_cutover_ready: false,
  atom_count: 43,
  provider_probe_required: 1326,
  provider_probe_proven: 0,
  cell_count: 99,
  legacy_verified_family_receipt_count: 0,
  atomic_proven_family_cell_count: 0,
  execution_ready: false,
}
```

`--gate` 必须在 `schema_valid !== true`、`proof_complete !== true`、
`atomic_cutover_ready !== true` 或 `atomic_proven_family_cell_count !== 99` 任一条件下
exit 1。现有 `verified_cell_count` 如为兼容而保留，只能明确表示 legacy family receipts，
cutover gate 不得读取它。

- [ ] **Step 2: 写 root-only SSOT RED**

为 repository policy helper 写临时目录测试，再由
`check-kernel-behavior-equivalence.mjs` 消费 helper：

- 只扫描 filesystem 的 `packages/**`；
- basename 含 `regression-contract` 且扩展为 `.yaml` 或 `.yml` 的全部文件，包括
  `foo.regression-contract.yaml`、`regression-contract.template.yaml`；
- YAML 顶层出现 `behavior_equivalence` 即 finding；
- 根合同缺 `behavior_equivalence` 即 finding；
- `docs/**` 和设计文本不进入 runtime contract 扫描。

导出 API：

```js
export function findSecondaryBehaviorEquivalenceContracts(repositoryRoot) {
  return [];
}

export function findForbiddenBehaviorLedgerTables(repositoryRoot) {
  return [];
}

export function evaluateRepositoryPolicy(repositoryRoot) {
  return {
    repository_policy_valid: true,
    duplicate_behavior_equivalence_contracts: [],
    forbidden_behavior_ledger_tables: [],
  };
}
```

测试必须先以空实现 RED，再实现真实扫描；临时目录至少包含
`packages/a/foo.regression-contract.yaml` 和
`packages/b/regression-contract.template.yaml` 两个逃逸尝试。不要 import 一个会立即
执行 `main()` 的 CLI。

输出字段：

```js
duplicate_behavior_equivalence_contracts: []
forbidden_behavior_ledger_tables: []
```

- [ ] **Step 3: 保留 forbidden ledger 精确扫描**

只扫描 production migrations 的 SQL token，剥离注释后拒绝
`CREATE [UNLOGGED|TEMP|TEMPORARY] TABLE [IF NOT EXISTS]
[schema.]behavior_ledger`。覆盖大小写、引号、schema-qualified、注释和合法文档提及；
不要因设计文档或 test fixture 提及该词而误报。

- [ ] **Step 4: 分离普通 CI 与 cutover gate**

把根合同 `KERNEL-BEHAVIOR-EQUIVALENCE-01.test_command` 从：

```text
node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json &&
node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json
```

改为：

```text
node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json &&
node scripts/ci/run-kernel-equivalence-drill.mjs --check --format=json
```

`packages/quality/__tests__/ci-core-regression.test.js` 和
`kernel-equivalence-drill-cli.test.js` 必须断言 root core regression 使用 `--check`，
同时独立 cutover CLI `--gate` 仍存在且在 0/99 时 exit 1。

- [ ] **Step 5: 实现 CLI GREEN**

`check-kernel-behavior-equivalence.mjs` 普通 contract CI 只要求 `schema_valid=true`；
`run-kernel-equivalence-drill.mjs --gate` 同时要求 schema/proof/readiness 全部为 true。

把 CLI 主逻辑抽成可注入 `repositoryRoot` 的 `runCheck()`，production `main()` 与 tests
调用同一个函数。测试分别放入 secondary SSOT 和 forbidden DDL，断言：

```js
expect(runCheck({ repositoryRoot: fixtureRoot }).exitCode).toBe(1);
expect(result.repository_policy_valid).toBe(false);
```

`repository_policy_valid` 与 `schema_valid` 正交；普通 `--check-report` 只有在两者都为
true 且 report 无 drift 时才能 exit 0。不能只打印 finding 后继续成功。

- [ ] **Step 6: 建立显式、非部署的 cutover workflow**

新增 `.github/workflows/kernel-equivalence-cutover.yml`：

```yaml
name: Kernel Equivalence Cutover Gate
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  gate:
    environment: kernel-equivalence-cutover
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json
      - run: node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json
```

这个 workflow 当前必须因 0/99 fail-closed；它不部署、不 merge、不 mutation。A2-8 再为它
接入 protected bundle store 和 production activation。增加静态测试，断言它先调用
repository/schema/report check、再调用 `--gate`，且不含 deploy/push/promote 命令。
这样 future 99/99 也不能绕过 second SSOT、forbidden ledger 或 report drift。

- [ ] **Step 7: 生成并核对报告**

```bash
node scripts/ci/check-kernel-behavior-equivalence.mjs --write-report
node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report
```

Expected: 两条命令成功；报告仍显示真实 gap，不能出现 atom proven。

- [ ] **Step 8: 运行 CLI 和 repository policy tests**

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-drill-cli.test.js \
  src/lib/__tests__/kernel-equivalence-repository-policy.test.js

cd ../quality
npx vitest run __tests__/ci-core-regression.test.js
```

Expected: PASS；`--check` exit 0，`--gate` exit 1 是预期测试行为。

- [ ] **Step 9: 运行无条件 core regression**

```bash
cd ../..
bash scripts/ci/run-core-regression.sh --tier pr
```

Expected: PASS；不能再因为 A2-0 刻意保持 0/99 而结构性失败。

- [ ] **Step 10: 提交**

```bash
git add \
  regression-contract.yaml \
  .github/workflows/kernel-equivalence-cutover.yml \
  scripts/ci/check-kernel-behavior-equivalence.mjs \
  scripts/ci/run-kernel-equivalence-drill.mjs \
  packages/brain/src/lib/kernel-equivalence-repository-policy.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-drill-cli.test.js \
  packages/brain/src/lib/__tests__/kernel-equivalence-repository-policy.test.js \
  packages/quality/__tests__/ci-core-regression.test.js \
  docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md
git commit -m "feat(kernel): gate atomic equivalence cutover"
```

## Task 8: Version, definitions, and full verification

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`

- [ ] **Step 1: 选择未占用 Brain patch version**

先读取当前 branch、`main` 和 `.brain-versions`，选择大于三者且未被已知并行 PR 使用的 patch
版本。不要在计划中硬编码当前可能已经过期的版本号。

Run:

```bash
bash scripts/check-version-sync.sh
node -e "console.log(require('./packages/brain/package.json').version)"
git show main:packages/brain/package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
git log --all --oneline -- packages/brain/package.json | head -20
```

Expected: 当前 branch version 同步，并获得 branch/main/并行历史版本事实；任何同步失败先修
计划输入，不能用 `|| true` 掩盖。

- [ ] **Step 2: 同步版本文件**

用仓库现有脚本提示的命令更新 package-local 版本和 lock：

```bash
cd packages/brain
npm version patch --no-git-tag-version
cd ../..
npm install --package-lock-only --ignore-scripts
```

然后把新版本追加到 `.brain-versions`，并更新 DEFINITION 的 Brain 版本行。检查实际 diff，
若 root `npm install --package-lock-only` 产生非版本相关 lockfile 重排，停止并调查，不能
整包接受。最终同步：

- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- root `package-lock.json`
- `.brain-versions`

不修改 Engine package/version，因为 A2-0 不修改 `packages/engine/`。

- [ ] **Step 3: 更新 definition**

记录：

- schema `1.1.0`；
- 43/446 inventory；
- 两级 Controller 不在 A2-0 中改运行时；
- schema valid 与 proof complete 分离；
- receipt v2/typed ports 尚未实现；
- live proof 仍为 0/99；
- 未 deploy。

- [ ] **Step 4: 运行聚焦验证**

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-atomic-contract.test.js \
  src/lib/__tests__/kernel-behavior-equivalence.test.js \
  src/lib/__tests__/kernel-equivalence-drills.test.js \
  src/lib/__tests__/kernel-equivalence-drill-cli.test.js \
  src/lib/__tests__/kernel-equivalence-repository-policy.test.js
```

Expected: 全部 PASS。

- [ ] **Step 5: 运行 root/quality/CLI gates**

```bash
cd packages/quality
npx vitest run \
  __tests__/regression-contract.test.js \
  __tests__/ci-core-regression.test.js

cd ../..
node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report
node scripts/ci/run-kernel-equivalence-drill.mjs --check --format=json
bash scripts/ci/run-core-regression.sh --tier pr
```

Expected:

- quality contract test PASS；
- report check PASS；
- drill check exit 0；
- JSON 明确 `schema_valid=true`、`proof_complete=false`、`execution_ready=false`、
  `legacy_verified_family_receipt_count=0`、`atomic_proven_family_cell_count=0`。

- [ ] **Step 6: 证明 release gate 正确失败**

```bash
node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json
```

Expected: exit 1，且失败原因是 atomic proof/readiness 不完整，不是 schema invalid。

- [ ] **Step 7: 运行版本和静态检查**

```bash
bash scripts/check-version-sync.sh
git diff --check
git status --short
```

Expected: version sync PASS、无 whitespace error、只有本计划范围内文件。

- [ ] **Step 8: 审计禁止项**

```bash
git diff --name-only HEAD~1..HEAD
rg -n \"CREATE TABLE.*behavior_ledger\" packages/brain/migrations packages/brain/src/migrations || true
```

确认：

- 无 migration/table；
- 无 ReleaseRun/risk/merge runtime mutation；
- 无 synthetic receipt/key；
- 无 push/PR/merge/deploy。

- [ ] **Step 9: 提交版本与定义**

```bash
git add \
  packages/brain/package.json \
  packages/brain/package-lock.json \
  package-lock.json \
  .brain-versions \
  packages/brain/DEFINITION.md \
  DEFINITION.md
git commit -m "docs(kernel): record atomic contract boundary"
```

## Final review gate

实现完成后必须依次执行：

1. fresh spec-compliance review；
2. fresh code-quality review；
3. 全分支 final review；
4. `superpowers:verification-before-completion`；
5. `superpowers:finishing-a-development-branch`。

任何 reviewer finding 未关闭前不得进入 A2-1。即使所有 A2-0 tests 通过，也只能声明：

```text
schema_valid = true
proof_complete = false
atomic_cutover_ready = false
family_cells = 0/99 proven
```

不能声明旧 Claude Code P0/P1 已完成等价证明。
