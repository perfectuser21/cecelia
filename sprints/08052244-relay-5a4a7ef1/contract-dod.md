# Contract DoD — P0 Kernel DevOps 堵点修复（relay 重试）

**Task ID**: `5a4a7ef1-461d-4c3a-b8f5-7ca8c5f638bc`
**Sprint**: `sprints/08052244-relay-5a4a7ef1`
**日期**: 2026-08-05

---

## 行为断言与验收命令

[BEHAVIOR] B-1: journey_step kernel-contract-a20 在 journey e6f803f2 中存在
manual:bash: curl -s "http://localhost:5221/api/brain/journey_steps?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29" | jq '[.[] | select(.name | test("kernel";"i"))] | length >= 1'

[BEHAVIOR] B-2: journey_step_links 中存在 artifact-verification 能力格子（cell_kind=capability，cell_status=gray，归属步骤 kernel-contract-a20）
manual:bash: curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&cell_kind=capability&limit=500" | jq '[.[] | select(.cell_key | test("artifact";"i"))] | length >= 1'
# 注意：artifact-verification 格子挂在 kernel-contract-a20 步骤下（不单独建步骤），step_id 由 B-1 写入步骤获取

[BEHAVIOR] B-3: journey_step_links 中存在 A2-0 合同维度格子 ≥ 4 格（cell_kind ∈ capability/element/scenario，cell_key 含 a20）
manual:bash: curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&limit=500" | jq '[.[] | select(.cell_key | test("a20";"i"))] | length >= 4'

[BEHAVIOR] B-4: 所有新写入格子（cell_key 含 a20 或 artifact）的 cell_status 均为 gray，不存在 green 状态
manual:bash: curl -s "http://localhost:5221/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&limit=500" | jq '[.[] | select(.cell_key | test("a20|artifact";"i")) | select(.cell_status == "green")] | length == 0'

---

## DoD 条目

- [ ] FR-3: journey_step `kernel-contract-a20` 通过 Brain API POST 写入，step_number=5，status=planned（B-1 验收通过）
- [ ] FR-1: artifact-verification 能力格子写入（cell_kind=capability，cell_key=artifact-verification-capability，cell_status=gray）（B-2 验收通过）
- [ ] FR-2: A2-0 合同维度 4 个格子写入完毕：
  - [ ] `a20-schema`（capability，gray）：regression-contract.yaml schema_valid=true 断言
  - [ ] `a20-proof`（element，gray）：proof_complete=false，0/99 已证明
  - [ ] `a20-cutover-gate`（element，gray）：atomic_cutover_ready=false
  - [ ] `a20-draft-blockers`（scenario，gray）：4 堵点均处于 open
- [ ] 所有 manual:bash 命令输出 true（B-1~B-4 全部通过）

---

## 铁律覆盖

- 不修改 PR #4457 代码（mutate_downstream_pr_allowed: false）✓
- Fleet transport（PR #4617）已合并，本 sprint 不重做 ✓
- 所有写入通过 Brain API（localhost:5221），不直接 psql 写入 ✓
- cell_status=gray（保守），不虚报 green（PR #4457 proof_complete=false，无 assertion_ref 无法点绿）✓
- 注意：API 有效值为 `gray`（非 `grey`），已在测试和验收命令中统一使用 `gray` ✓

---

## 写入顺序约束

1. POST journey_steps（FR-3）→ 获取 step_id
2. POST journey_step_links x5（FR-1 + FR-2 四格）→ 依赖 step_id
3. 验收：运行全部 manual:bash 命令确认输出 true
