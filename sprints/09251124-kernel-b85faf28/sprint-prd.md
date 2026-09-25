# Sprint PRD — relay-projection 推 Notion Projects 库缺列一致性闸（Status 非 select / AI Project·Run ID·Remark 不存在）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（接力棒投影不再静默停更，管家闭环可信）

## 背景

2026-09-25 11:19 建 project 根 `bf5088a3` 后，Brain 日志出现
`[relay-projection] project bf5088a3 推送失败: Notion PATCH /pages/3e6c40c2-... → 400: Status is expected to be select. AI Project / Run ID / Remark is not a property that exists`。
根因同 09-08「Notion 缺列三连坑」：投影代码写的列在目标 Projects 库不存在或类型不符
（`Status` 代码发 `status` 类型、库要 `select`；`AI Project`/`Run ID`/`Remark` 三列库里根本没有），
`pushProjectRoots` 的 `try/catch` 逐行吞错只 `stat.failed++`，导致镜子页静默停更。
已有 proven 机制 `ops-notion-schema.js` 的 `diffMissingProps` / `ops-quota-notion.js` 的 `ensureOpsDbProps`
（缺列即补，幂等），本 sprint 复用它给 relay-projection 补一致性闸。

## Golden Path（核心场景）

系统从 [Brain tick 触发投影] → 经过 [推送前补列+类型对齐] → 到达 [根页 200 + 四块可见]

具体：
1. Brain tick（每 5 分钟）调 `runRelayProjection` → `pushProjectRoots` 遍历 project 根任务（含 `bf5088a3`）
2. 推送某根页前，先对 Projects 库执行「缺列即补」：以一份**集中定义的列清单**（含 `Status` 为 `select`、
   `AI Project` checkbox、`Run ID` rich_text、`Remark` rich_text）比对目标库真实 schema，缺的列幂等 PATCH 补上，
   已存在的列不覆盖；随后再 PATCH 页属性 + 重写正文
3. 可观测结果：`PATCH /pages/{id}` 返回 200，Projects 库该页出现「目标 / 链 / 待拍板 / 最近交接」四块正文，
   Brain 日志不再出现 `[relay-projection] ... 400`；一致性 smoke（proven-to-fire）确认每个目标列存在且类型匹配

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- **列名存在但类型不符**（`Status` 库里是 `select`、代码发 `status`）：一致性闸必须能抓到（不能只按列名 diff——
  `diffMissingProps` 仅比对列名会漏掉类型不符，导致补列后仍 400），Status 写法须与库真实类型对齐
- **目标库四列已齐全**：ensureProps 空 diff → 跳过 PATCH，不覆盖主理人手调过的列配置
- **库不存在 / token 无权限 / 补列 PATCH 失败**：显式失败计数 + 告警，禁止静默吞错后 `continue`（本次根因）
- **页被删（404）**：沿用既有重建逻辑，补列闸不得破坏该路径

## 范围限定

**在范围内**：`notion-relay-projection.js` 对 Projects 库（`PROJECTS_DB`）的推送路径——集中列定义、推送前 ensureProps 补列、
`Status` 类型对齐、含类型校验的一致性 smoke（proven-to-fire）、先写能复现 400 的 failing test。
**不在范围内**：决策草案库（`pushPendingDecisions` / `DECISIONS_INLET_DB`）的列治理；Notion 正文块结构改动；
投影调度频率；其它 Notion 库（ops 四库已由 `ops-notion-schema` 覆盖）。

## 假设

- [ASSUMPTION: 目标 Projects 库 `Status` 列类型为 `select`（按 400 报文），修复以库真实类型为准；若库应为 `status` 类型则改由建库侧统一，本 sprint 以报文口径对齐 `select`]
- [ASSUMPTION: 复用 `ops-notion-schema.js` 的 `diffMissingProps` 并按需扩展为「列名+类型」双校验，或新增等价集中列定义，不推翻既有 ops 机制]
- [ASSUMPTION: 改动 `packages/brain` 前依次过 DevGate（facts-check / check-version-sync / check-dod-mapping），失败则先修]

## 预期受影响文件

- `packages/brain/src/notion-relay-projection.js`：新增集中列定义（如 `PROJECTS_DB_PROPS`），推送前接 ensureProps 补列，`buildProjectProps` 的 `Status` 写法与库类型对齐
- `packages/brain/src/ops-notion-schema.js`：复用/扩展 `diffMissingProps`（列名+类型一致性）
- `packages/brain/src/__tests__/notion-relay-projection.test.js`：新增能复现 400（Status 类型不符 + 三列缺失）的 failing test，修复后永久留作回归
- （可能）新增一致性 smoke 脚本 + 登记进 smoke-allowlist

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + Notion API 校验 + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 触发 relay-projection + 核验 Notion 页）
# 期望验收点（自然语言）：
#  1. 触发 runRelayProjection 后，重推 project 根 bf5088a3，Notion PATCH /pages 返回 200（非 400）
#  2. Projects 库该页出现「目标 / 链 / 待拍板 / 最近交接」四块正文
#  3. 一致性 smoke 在缺列/类型不符时能真实 FAIL（proven-to-fire），四列齐全且类型匹配时 PASS
#  4. Brain 日志无新的 [relay-projection] ... 400 记录
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空，journey_id=none）；PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用现有 notionReq 默认）
- 频控: 待定（沿用 tick 每 5 分钟；补列为幂等，正常仅首次 PATCH）
- 版本要求: 无
- 可观测: 推送/补列失败必须带失败计数指标并写 Brain log（禁止静默吞错，见 Invariant）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 空，journey_id/ability_id=none）。下列为与本 sprint 直接相关项 + [系统]核心红线；Projects 库外的 94 条 area 铁律全局仍适用 -->
- [catch失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [枚举常量单份] 枚举语义常量/列定义只允许一份，落在被各消费方共同 import 的 service，禁手抄副本（来源: area）
- [声明消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [失败契约显式判] 调用"失败返回 null/false 不抛异常"契约的函数，写完成功分支必须显式处理失败分支（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [凭据安全] API Key/Token 不入 git，日志脱敏（来源: area）
- [租户隔离] 测试默认多租户，租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id=none（非路径 C 点火）→ 优雅降级 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅涉 packages/brain/ 后端投影逻辑，无 UI、无远端 agent 协议，纯 Brain 内部后台任务
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部/后端任务，E2E 在本地 evaluator 走 curl localhost:5221 + Notion API 校验 + psql
## journey_id: none
## step_id: none（PrepPRD 未锚定）
