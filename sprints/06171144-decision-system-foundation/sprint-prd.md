# Sprint PRD — Decision System 地基：level/target_type/scope 流程走通（含 Notion 同步）

## OKR 对齐

- **对应 KR**：Cecelia Harness/Dev 基础设施（决策统一存储 = 后续 Gate1/Gate2 共享白板的地基）
- **当前进度**：DB 列已上线（migration 302），流程未通
- **本次推进预期**：把"光线上有列"做成"Brain API 能读写 + tick 同步进 Notion + 端到端 smoke 可验"

## 背景

`decisions` 表已按 `level`（area/ability/feature/step）分层存「局部决策(含 NFR)」+「全局战略决策」，`target_type`+`target_id` 多态指向（ability/feature→journey_features），`scope`（v1/backlog）独立列。DB 改动已应用线上库（migration 302，本次不碰 migration）。本次把这套从"有列"做成"能真用"，为后续 Gate1 驾驶舱 / Gate2 闭环留好共享白板。

## Golden Path（核心场景）

用户/系统从 [给某 ability 记一条决策] → 经过 [落库 + tick 同步进 Notion] → 到达 [按 ability+scope 查回决策清单当验收单]

具体：
1. 系统/用户 `POST /api/brain/decisions`，带 `{category:'nfr', topic:'前后台', decision:'后台静默', level:'ability', target_type:'journey_feature', target_id:<某真实 ability id>, scope:'v1'}` → 写进 `decisions` 表 → 返回该决策 id（201）
2. Brain tick 同步 → 该决策出现在 **Notion AI Notes 库**（Type=Decision），带 **Level=ability / Scope=v1**，并**链到那个 ability**（Notion relation）
3. 用户 `GET /api/brain/abilities/<id>/decisions?scope=v1` → 拿回该 ability 的 v1 决策清单（= "验收只看一张"那张表）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- `target_id` 不是合法 journey_features id → 400 + error(string)
- `level` 非法（不属于 area/ability/feature/step）→ 400 + error(string)
- `GET .../abilities/<id>/decisions` 该 ability 无决策 → 返回空清单（非报错）
- 同一决策重复 tick 不应重复推 Notion（已有 notion_synced_at 的不重推）

## 范围限定

**在范围内**：
- Brain API：写 ability/feature 级决策 + 读"某 ability 的 v1 决策清单"
- 扩 `pushDecisions`：把 `level/target_type/scope` map 进 Notion AI Notes 库，并链到对应 ability
- 端到端 smoke：建决策→落库→tick 同步进 Notion→GET 查得回（先 failing 再实现）

**不在范围内**（backlog）：
- Dev 驾驶舱 HTML、Gate1 决策扫描自动生成、Gate2 report 透传 assumption、`decision_catalog` 题库、无头红队按钮、95k 空噪音行清理、dep-audit 修复、migration 改动

## 假设

- [ASSUMPTION: Notion AI Notes 库（185c40c2-ba63-828c-973f-81a9c4582cd6）已有或可加 Level/Scope 字段及指向 ability 的 relation；若 relation 字段不存在，先以文本属性兜底并在 PR 说明]
- [ASSUMPTION: 真实可测 ability 取自 journey_features WHERE kind='ability'（约 23 个）]
- [ASSUMPTION: Notion key 走 CCAPI2026 集成（1Password CS "Notion"）]

## 预期受影响文件

- `packages/brain/src/`（决策写/读 API 路由）：新增 POST decisions（带 level/target_type/target_id/scope 校验）+ GET abilities/<id>/decisions
- `packages/brain/src/notion-push-sync.js`（pushDecisions, ~288 行）：map level/target_type/scope 进 Notion properties + 链 ability relation
- smoke / 测试文件：failing smoke 先行（commit-1），实现后转绿（commit-2）

## E2E 验收

> Planner 初稿留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql + Notion API）。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl + psql + Notion API 查 page properties）
# 期望验收点（自然语言）：
# 1. POST /api/brain/decisions（level=ability + target→真实 ability + scope=v1）→ 201；psql 查 decisions 该行 level/target_id/scope 正确
# 2. 触发 notion 同步后，Notion AI Notes 库出现该决策页，Level/Scope 字段正确，且链到对应 ability（Notion API 查 page properties 确认）
# 3. GET /api/brain/abilities/<id>/decisions?scope=v1 → 返回含该决策；非法 target_id / 非法 level → 400 + error(string)
# 4. 先 failing smoke（commit-1）再实现（commit-2）；CI 全绿（dep-audit 既有问题除外）
```

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 是 Cecelia Harness/Dev 基础设施（决策统一存储白板），服务无头/inline dev 流程，PrepPRD 明确归属 Cecelia Harness Pipeline 这条 dev_pipeline。
## target_environment: local_api
## target_environment_reason: 改动仅在 packages/brain/（API + notion-push-sync），E2E 走本地 evaluator（curl localhost:5221 + psql cecelia）+ Notion API 查 page properties，无 UI / 无 Windows / 无远端部署。
## journey_id: Cecelia Harness Pipeline（来源 = task.payload.journey_id；payload 未注入 UUID 时取 PrepPRD 锚定结果：Cecelia 唯一 Line = Harness Pipeline）
## step_id: decision-storage-foundation（来源 = PrepPRD Golden Path 锚定：decisions 表 level/target/scope 流程走通这一步）
