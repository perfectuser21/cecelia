# Contract Draft — P0 Kernel DevOps 堵点修复（relay 重试）

**Task ID**: `5a4a7ef1-461d-4c3a-b8f5-7ca8c5f638bc`
**Sprint**: `sprints/08052244-relay-5a4a7ef1`
**日期**: 2026-08-05
**目标 Journey**: F1 开发闭环（`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，dev_pipeline）

---

## 背景

PR #4457（Kernel Harness 累积分支，A2-0 原子行为等价合同，11 行为族 S0-S12，43 原子行为，446 探针）处于 Draft-OPEN 状态，494 commits ahead，尚未映射到 Brain DB 格子账本。PR #4617（Fleet transport 堵点修复）已于 2026-08-04 合并，不在本 sprint 范围内。

本 sprint 的唯一交付物：将 PR #4457 代表的工作以及 artifact 可验证性审计缺口，通过 Brain API 写入 `journey_step_links` 格子账本，不修改任何代码分支。

---

## [BEHAVIOR] 断言列表

[BEHAVIOR] B-1: `journey_steps` 表中，journey `e6f803f2` 下存在名为 `kernel-contract-a20` 的骨干步骤
- 前置：step_number=5（追加在已有4个步骤之后）
- 期望：GET /api/brain/journey_steps?journey_id=e6f803f2-... 结果中，name 含 "kernel" 的条目 ≥ 1

[BEHAVIOR] B-2: `journey_step_links` 格子账本中，存在 `artifact-verification` 能力格子（cell_kind=capability，cell_status=gray）
- 归属步骤：**kernel-contract-a20**（即 B-1 创建的步骤，step_id 由 B-1 获取；artifact-verification 格子不单独建步骤，挂在 kernel-contract-a20 步骤下）
- cell_key: artifact-verification-capability
- assertion_ref: PR #4457 分散实现、无独立模块审计记录
- 期望：GET /api/brain/journey_step_links?journey_id=e6f803f2-...&cells=1&cell_kind=capability 返回结果中，cell_key='artifact-verification-capability' 的条目存在，且其 step_id 对应 kernel-contract-a20

[BEHAVIOR] B-3: `journey_step_links` 格子账本中，存在 A2-0 合同维度格子共 ≥ 4 格（cell_kind ∈ capability/element/scenario）
- 格子清单：
  - a20-schema（capability）：regression-contract.yaml schema_valid=true 断言
  - a20-proof（element）：proof_complete=false，0/99 已证明
  - a20-cutover-gate（element）：atomic_cutover_ready=false，manual gate exits 1
  - a20-draft-blockers（scenario）：4 个堵点（rebase/测试失败/QuickCheck/receipt v2）均 open
- 期望：GET cells=1 结果中，含 "a20" 的 cell_key 条目 ≥ 4

[BEHAVIOR] B-4: 所有新写入格子的 `cell_status` 均为 `gray`，不存在 `green` 状态
- 原因：PR #4457 proof_complete=false，当前无经过机器验证的 assertion_ref，不允许虚报 green
- 期望：GET cells=1 结果中，本 sprint 写入的全部格子 cell_status != 'green'

---

## E2E 验收

以下步骤全部为 `manual:bash` 可执行命令：

### Step 1：验证 kernel-contract-a20 步骤存在（B-1）
```bash
curl -s "http://localhost:5221/api/brain/journey_steps?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29" \
  | jq '[.[] | select(.name | test("kernel";"i"))] | length >= 1'
# 期望输出: true
```

### Step 2：验证 artifact-verification 能力格子存在（B-2）
```bash
curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&cell_kind=capability" \
  | jq '[.[] | select(.cell_key | test("artifact";"i"))] | length >= 1'
# 期望输出: true
```

### Step 3：验证 A2-0 合同维度格子 ≥ 4 格（B-3）
```bash
curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1" \
  | jq '[.[] | select(.cell_key | test("a20";"i"))] | length >= 4'
# 期望输出: true
```

### Step 4：验证所有新格子均为 gray（B-4）
```bash
curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1" \
  | jq '[.[] | select(.cell_key | test("a20|artifact";"i")) | select(.cell_status == "green")] | length == 0'
# 期望输出: true（无 green 格子）
```

---

## 未覆盖真实链路清单

- PR #4457 代码层面无法实际运行或执行，本 sprint 仅做账本映射，不执行真实 Kernel Harness E2E
- artifact-verification 格子状态 gray 仅代表"已审计发现分散实现"，不代表真实验收通过
- A2-0 proof（0/99）格子仅记录当前状态快照，非实际测试运行结果
- 所有格子 cell_status=gray，待 PR #4457 合并且 CI 通过后，由评估器（evaluator）机器点绿，人工不介入状态变更
