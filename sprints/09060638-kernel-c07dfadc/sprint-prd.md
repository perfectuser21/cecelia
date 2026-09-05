# Sprint PRD — map↔画布对齐：画布 stages 由 golden_path 生成 + run 终态回写 step 成熟度

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+2%（map 成为 SSOT + 实时体检表，消除双写漂移）

## 背景

现状两份数据各写各的：`golden_path` 表的 step 与 n8n 画布 stages 相互独立、易漂移。
本 sprint 让 **map 一行 = 一张画布**（L3 ability→画布，L4 step→格，L5 feature→技能体），
画布 stages 从 map 生成（**map = SSOT**），并让 run 终态回写 step 成熟度，使 map 变成实时体检表。
依赖「第2件」契约 schema（见假设）。

## Golden Path（核心场景）

系统对某 map scope（含一个 L3 ability 及其 golden_path steps）请求投影 → 生成画布 stages → run 终态回写成熟度 → map 体检表可读。

具体：
1. [触发] 对某 scope 请求 map 投影/查询（该 scope 下有一个 L3 ability，其 golden_path 已含有序 steps）。
2. [系统处理] map 投影引擎以 golden_path 为 SSOT 生成画布 stages：L3 ability→一张画布，L4 step→一个格，L5 feature→一个技能体；不再由画布侧独立手写。
3. [触发] 某 harness run 到达终态（PASS / FAIL / blocked）。
4. [系统处理] 终态回写对应 step 的成熟度字段到 map（幂等：step 不存在则跳过并记日志，不写脏数据）。
5. [可观测结果] 再次查询 map：一行=一张画布，画布 stages 与 golden_path steps 结构/条数/顺序对齐；对应 step 的成熟度反映最近 run 结果 —— map 成为实时体检表。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- golden_path 无 step / 空 ability → 画布为空但不报错。
- run 终态回写找不到对应 step（step 已删 / 换代导致 receipt 锚过期）→ 幂等跳过 + 记日志，不写脏数据。
- 并发多个 run 回写同一 scope → 需事务/串行保护（对齐 map-projection-store 既有 lock scope 机制）。

## 范围限定

**在范围内**：
- 画布 stages 从 map/golden_path 生成（map=SSOT），三层映射 ability→画布 / step→格 / feature→技能体。
- run 终态回写 step 成熟度到 map，使 map 成为实时体检表。

**不在范围内**：
- n8n / OpenClaw 端画布 UI 渲染（外部渲染不在本 sprint）。
- 契约 schema 本体定义（由「第2件」负责）。
- 手写画布 stages 的历史数据迁移工具。

## 假设

- [ASSUMPTION: 「第2件」契约 schema 已交付且可被本 sprint 消费（change_kind 注明「依赖第2件契约 schema」）]
- [ASSUMPTION: map scope 的 manifest 以 golden_path 作为 step 源；当前 `/api/brain/map?scope=F1` 投影为空，需先有 manifest]
- [ASSUMPTION: 成熟度字段挂在 map projection 的 step 层节点上，run 终态回写更新该节点]
- [ASSUMPTION: 换代导致 routing receipt 锚过期属路由层，不改变本 PRD 的产品行为]

## 预期受影响文件

- `packages/brain/src/lib/map-projector.js`：map 投影引擎，从 golden_path 生成画布 stages（SSOT）。
- `packages/brain/src/lib/map-projection-store.js`：scope lock + 事务持久化，回写成熟度落库。
- `packages/brain/src/lib/map-read-service.js`：`readHealth()`/`readMap()`，map 体检表读出口。
- `packages/brain/src/routes/map.js`：`/api/brain/map` 查询/重建端点。
- `packages/brain/src/orchestrator/kernel-run-store.js`：run 终态 → step 成熟度回写。
- `packages/brain/src/orchestrator/home-sequencer.js`：STAGE_ORDER 与画布 stages 对应关系。
- `packages/brain/src/golden-path-contracts.js`：golden_path→map_scope 胶水，锚定三层映射。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 副源均为空）；PrepPRD 未显式给值 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定
- 版本要求: 无
- 可观测: 回写失败/跳过必须写 Brain log（幂等跳过需可追溯）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 源（step/journey_feature 源为空，ability_id=null）；已去噪 smoke fixture -->
- [多租户] 测试默认多租户，数据按租户隔离（来源: area）
- [真验证] 真环境验证才算 done，禁止仅凭"测试通过"收尾（来源: area）
- [禁写死] 禁止写死环境假设值（来源: area）
- [凭据安全] 凭据不入库不入 git（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [planner分支] planner 使用服务端签发的 role branch，禁自行 checkout（来源: area）
- [PR冲突路由] PR 与 main 冲突(DIRTY)时路由 generator-fix rebase，禁死等/判死（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现有 ability 均为 planned 态 -->
- （本 line 暂无 done/working 历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（curl + psql）
# 期望验收点（自然语言）：
# 1) 对含 golden_path steps 的 scope 查 /api/brain/map，返回画布 stages 与 golden_path steps 结构/条数/顺序对齐（ability→画布, step→格, feature→技能体）。
# 2) 触发一个 harness run 到达终态后，psql 查对应 map projection step 节点的成熟度字段已按 run 结果更新。
# 3) 对不存在的 step 回写时幂等跳过，无脏数据写入，Brain log 有记录。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain 后端（map 投影 / golden_path / run 终态回写），无 UI/agent 协议/engine hook。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端能力，E2E 走本地 curl localhost:5221 + psql 验证 map 投影与成熟度回写。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
