# Universal Map Projection Engine — Knife 2 Contract Draft

**Sprint**：`sprints/08111015-universal-map-knife2/`
**Task ID**：`8c6e3ff5-5a27-401a-8cfc-95a8836c7bb4`
**PR 序号**：Knife 2/5
**起草日期**：2026-08-11

## 范围

本 Knife 只交付确定性结构投影：

1. `map_projection_runs/nodes/edges` 可重建派生池。
2. Manifest → 稳定节点与关系边的纯确定性变换。
3. Boundary 生成 `hands_off_to` 边，不生成 Boundary 节点。
4. Cross-cut 生成独立节点，以及 `serves/owned_by` 边，不计入 Capability。
5. Shared Prerequisite `applicable=false` 时不生成伪节点。
6. 原子写完整 projection，再切 active run；Manifest 激活与 projection 同事务。
7. Cecelia 冻结输入的 2×11×2×7 真实 PostgreSQL 验收与 digest 重建验收。

**明确排除**：锚点匹配、receipt 状态现算、Unified Map 读 API、Dashboard、ZenithJoy adapter；由 Knife 3–5 交付。

## 稳定身份合同

- Node stable ID 只由 `scope_key + node_type + entity key` 计算，不含名称、顺序、run ID 或时间。
- Edge stable ID 只由 `scope_key + edge_type + edge key` 计算。
- 相同 Manifest digest、fact revisions 与 projector version 必须生成相同 projection digest。
- 节点/边按稳定 ID 排序后参与 digest；数据库插入顺序不影响结果。

## 持久化合同

- `map_projection_runs` 记录 scope、manifest version/digest、fact revisions、projector version、projection digest、status/error/时间。
- `map_projection_nodes` 保存 run、稳定 ID/key、node type、展示字段、source refs 与非权威 attributes。
- `map_projection_edges` 保存 run、稳定 ID/key、edge type、两端 stable ID、声明 attributes 与 source refs。
- 每 scope 最多一个 active run。
- run 与全部节点/边在一个事务写入；任一步失败不得留下 building run 或半张图，旧 active 不变。

## 结构规则

- 每个 Value Stream 与 Capability 生成节点，并生成 Value Stream → Capability `contains`。
- 每个 Boundary 生成 Capability → Capability `hands_off_to`，statement 存 edge attributes。
- 每个 Cross-cut 生成 crosscut 节点；对 `serves` 引用生成 Cross-cut → 目标的 `serves`；存在 owner 时生成 Cross-cut → owner Capability 的 `owned_by`。
- `shared_prerequisites.applicable=false` 时节点和 `requires` 边均为零。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Migration | `packages/brain/src/__tests__/migration-405-map-projection.test.js` | 三张派生表及 run-scoped FK/active 约束 | migration 405 不存在 |
| Real schema | `packages/brain/src/__tests__/integration/migration-405-map-projection.integration.test.js` | 真实 PostgreSQL 约束生效 | 三张表不存在 |
| Topology | `packages/brain/src/lib/__tests__/map-projector.test.js` | 2×11×2×7、Boundary/Cross-cut/Prerequisite 规则 | projector 模块不存在 |
| Determinism | `packages/brain/src/lib/__tests__/map-projector.test.js` | 稳定 ID 与 projection digest 可重复 | 缺 stable identity/digest |
| Atomicity | `packages/brain/src/__tests__/integration/map-projection-store.integration.test.js` | 激活、替换、失败回滚、无半张图 | projection store 不存在 |
| Activation | `packages/brain/src/lib/__tests__/map-manifest-store.test.js` | 默认激活调用真实 projector，不再 503 | 默认 projector unavailable |
| Smoke | `packages/brain/scripts/smoke/map-projection-smoke.sh` | scratch 激活、DB 数量、清空重建 digest | schema/store/projector 未交付 |

## 验收

行为和真实证据以同目录 `contract-dod.md` D1–D8 为准；任何通过逐节点插入测试 fixture 冒充完整 Manifest 投影的验收无效。
