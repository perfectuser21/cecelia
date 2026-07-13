# 小改动 PrepPRD：九要素T6 两轴衔接——KR↔Ability 轻边 + 对账端点

## 改什么
架构依据：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（T6 行，设计已拍板 PR #3731）。
Brain task: f477cf9a-5b39-4f47-b07e-0aa00d239a2b（plan=nine-elements-integrity, seq=6）。

**cecelia repo（本 PR）**：
1. `packages/brain/src/routes/task-goals.js` PATCH `/goals/:id`：新增 `metadata` 字段支持，
   JSONB merge 写法 `metadata = COALESCE(metadata,'{}'::jsonb) || $n::jsonb`（与 custom_props 同法），
   使 decomp 拆 KR 时可 `PATCH /api/brain/goals/:kr_id -d '{"metadata":{"target_abilities":["<ability_id>",...]}}'`。
   注意该路由先试 objectives 再试 key_results——objectives 表也有 metadata 列则两边通用；无则仅对 key_results 生效（需查证 objectives 列）。
2. `packages/brain/src/routes/okr-hierarchy.js` 新端点 `GET /kr/:id/ability-progress`
   （挂载后全路径 `/api/brain/okr/kr/:id/ability-progress`）：
   - 读 key_results 行，取 `metadata.target_abilities`（空/缺省 → 返回空 abilities 数组 + hint）
   - join `journey_features`（id/name/thickness/status，kind='ability'）
   - join `advancement_items` 聚合每个 ability 的 done/doing/todo + progress（复用 computeProgress）
   - 返回对账视图：`{kr_id, kr_title, abilities:[{ability_id,name,thickness,status,advancement:{done,doing,todo,progress}}], missing_ability_ids:[]}`
   - metadata 里引用了不存在的 ability_id → 列入 missing_ability_ids（对账就是要暴露这种失联）
3. brain version bump（semver minor）。

**zenithjoy-skills repo（第二 PR，merge 后刷 dist）**：
- decomp skill：Phase 1 KR 拆解段加死步骤——拆完 KR 必须把该 KR 对应的 ability id 列表
  写进 `key_results.metadata.target_abilities`（curl PATCH /api/brain/goals/:kr_id）；
  ability id 来自 journey_features catalog（GET /api/brain/journey_features 语义匹配，禁凭空造）。

## 为什么改
两轴衔接：OKR 轴（季度意志）现在够不着能力轴（journey_features/advancement_items 资产账本），
季度末无法对账"这个 KR 到底推进了哪些能力、推进到什么厚度"。轻边起步（JSONB 约定 key，
零 migration），验证有用后再转正式列（架构关键决策表第 4 行，选项 B）。

## 关联上下文
- 相关 Journey：bb8cc561-b3ee-4fec-b74d-2255694bd963（payload.journey_id）
- 相关决策：27b57469 / 06f78c9a / 69b90b1d（推进项账本）
- 前序：T1-T5 已全部完成（T3 #3750 / T4 #3755 / T5 zenithjoy-skills#124+#3753）

## 影响范围
- PATCH /goals/:id 加可选字段，向后兼容（不传 metadata 行为不变）
- 新端点只读，无副作用
- decomp skill 加写库步骤，不改既有拆解逻辑

## 判定点登记表
（本任务无接缝判定点，N/A——全部为库内 SQL join，无外部真实状态推断）

## 验收标准
- [ ] 单测：PATCH metadata 写入（merge 语义）+ ability-progress 端点 join/空值/missing id 三分支
- [ ] manual 验证：对账视图数字与 journey_features/advancement_items 直查一致
- [ ] CI 全绿
