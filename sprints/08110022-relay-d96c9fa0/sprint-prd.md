# Sprint PRD — Harness Impact Contract & Gap Resolution Loop

- **Task ID：** d96c9fa0-83bd-40dc-b731-4f541c43af32
- **Sprint Dir：** sprints/08110022-relay-d96c9fa0
- **日期：** 2026-08-11
- **Gear：** segmented（6 段）
- **归属 Journey：** F1 开发闭环（e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29）
- **锚点步骤：** 步2 合同即法律（406b621a-3e2e-4e8c-a818-682747324c18）

---

## 目标

加厚 F1 前三步：接单即分档 → 编码前持久化 Impact Contract → 编码后按真实 diff 复算影响。
未声明影响触发 `CONTRACT_IMPACT_DRIFT`，形成可追踪 gap 并硬阻塞原任务，直到当前 revision 断言验真通过。

---

## Invariant 约束

> **来源：** DevGate 全局强制规则（适用于所有 packages/brain 改动）

1. **Brain 改动门禁（DevGate 三连）：** 改动 `packages/brain` 前必须依次通过：
   - `node scripts/facts-check.mjs`
   - `bash scripts/check-version-sync.sh`
   - `node packages/quality/scripts/devgate/check-dod-mapping.cjs`
   任一失败禁止继续编码。

2. **Migration 号无碰撞：** main 已使用到 `401`，Universal Mapper 分支预留 `402`；本方案使用正式迁移 `403`、`404`。

3. **change_kind / gear 严格分离：** `change_kind` 只表达变化语义，`gear` 只表达执行强度，禁止互相赋值或混用字段。

4. **Mapper fail-closed 原则：** Mapper stale / unavailable / revision mismatch / 无 freshness 证据，一律判定 `impact_unknown`，门禁不放行，绝不当作空影响。

5. **Red-then-Green 顺序：** 每个行为变化先保留 failing test（RED），再写最小实现（GREEN），测试永久留在 CI，不得删除。

6. **MJ5 依赖边界：** Segment 1–2 可独立运行；Segment 3–6 的 Kernel 接线可先落地，但 `/api/brain/map/radius`、digest、freshness 未通过真实环境验收时必须 fail-closed，不能生成 active 合同或 PASS 回执。

7. **Gap 状态机单向流转：** `open → assigned → fixing → verifying → resolved`；验真失败进入 `reopened`，只能回到 `assigned`。关闭必须引用当前 revision 的真实断言回执。

---

## 累积 FR

### FR-1 Change Normalizer（Segment 1）

**文件：**
- 新建 `packages/brain/src/impact-contract/change-kind.js`
- 新建 `packages/brain/src/impact-contract/__tests__/change-kind.test.js`
- 修改 `packages/brain/src/routes/task-tasks.js`
- 修改 `packages/brain/src/harness-skill-relay.js`

**行为：** 将任务变更语义归一为四类：`new_capability` / `capability_change` / `bugfix` / `parameter_only`。`change_kind` 与 `gear` 分别计算、分别留痕，禁止覆盖。

**验收：** 任意输入映射正确；无效输入 400 拒绝；`change_kind` 与 `gear` 字段在 DB 和 payload 中独立存在。

---

### FR-2 Impact Contract Schema 与持久化（Segment 2）

**文件：**
- 新建 `packages/brain/src/impact-contract/contract-schema.js`（Zod schema）
- 新建正式 migration `406_impact_contracts.sql`（`harness_impact_contracts` 表）
- 新建 `packages/brain/src/routes/impact-contracts.js`

**合同字段：** 变更目标、`change_kind`、base revision、manifest/projection digest、受影响 Capability/Feature/AC、必跑断言、freshness 证据、不适用项及理由。

**验收：** schema 合法的合同写入 DB 并可查询；schema 非法的合同被 Structure Gate 拒绝（400）；Mapper 不可达时合同创建失败（503）。

---

### FR-3 Structure Gate（Segment 2 后半）

**行为：** 编码前合同只接受 schema 合法、引用完整、facts 新鲜的合同。Mapper 不可达、数据陈旧、revision 不一致均视为不可判定，而非零影响。

**验收：** 三种不可判定情形均拒绝放行并返回可重试原因。

---

### FR-4 Diff Impact Gate 与 drift 仲裁（Segment 3，需 MJ5 合同）

**行为：** 编码后以真实 diff 重新查询 `POST /api/brain/map/radius`，与合同对账：
- 实际影响 ⊆ 声明影响：进入正常验收
- 新增影响已有断言：扩展合同并运行新断言
- 新增影响缺少断言：产生 `CONTRACT_IMPACT_DRIFT` → Gap Ledger

**验收：** 一个未声明影响的真实 diff 使门禁变红、建 gap、阻塞原任务。

---

### FR-5 Gap Ledger（Segment 4–5，需 MJ5 合同）

**文件：**
- 正式 migration `407_harness_gap_ledger.sql`（新建 `harness_gaps` / `gap_events`，加厚既有 `task_dependencies`）
- `packages/brain/src/impact-contract/gap-store.js`

**行为：** 记录开发过程中发现的缺口生命周期（发现→认领→修复→验真→关闭）。gap 修复任务完成且可信的当前 revision 断言回执 PASS 后，原任务恢复为 `queued`、清除旧 claim，并由 Dispatcher 重新派发。

**验收：** 修复任务完成后原任务恢复；回调重复时幂等去重；gap owner 不存在时进入分诊队列并告警。

---

### FR-6 全链生产等价演练（Segment 6）

**行为：** 端到端：任意实际 diff → 可追溯影响裁决 → 若有未声明影响 → gap 建立 → 依赖阻塞 → 修复 → 恢复。Mapper stale/不可达/revision mismatch 均不产生假绿。

**验收：** 全链回归永久纳入 CI；ffprobe/DB 等生产等价断言替代"测试通过"。

---

## NFR

- 幂等性：相同 active 合同语义 hash、gap 事件与 gap/repair 关联均幂等；历史合同版本保持 append-only。
- 稳定性：Mapper 不可达不导致 Brain crash，返回可重试错误码。
- 可观测：`CONTRACT_IMPACT_DRIFT` 事件写入 `gap_events`，可被 cockpit 展示。
- 性能：Structure Gate 响应 < 500ms（不含 Mapper 网络时延）。

---

## 交付顺序（刀次）

| 刀次 | 内容 | MJ5 依赖 |
|------|------|----------|
| 刀1 | Change Normalizer + change_kind/gear 分离（FR-1） | 无 |
| 刀2 | Impact Contract Schema + 持久化 + Structure Gate（FR-2, FR-3） | 无 |
| MJ5 | radius/digest/freshness 合同验真 | — |
| 刀3 | Structure Gate 接入真实 Mapper（FR-3 全） | 需 MJ5 |
| 刀4 | Diff Impact Gate + drift 仲裁（FR-4） | 需 MJ5 |
| 刀5 | Gap Ledger + 依赖 + 恢复闭环（FR-5） | 需 MJ5 |
| 刀6 | 全链演练 + CI 入账（FR-6） | 需 MJ5 |

---

## 法源决策

- `f69c2f91` — 四档分流 change_kind/gear 正交
- `4bc109e9` — Impact Contract 合同即法律
- `9b0fd1b5` — Gap Resolution Loop 与硬依赖机制

---

journey_type: capability_change
target_environment: brain_local
