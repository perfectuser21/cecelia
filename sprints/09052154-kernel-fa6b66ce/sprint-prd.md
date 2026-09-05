# Sprint PRD — 四格路由器：POST /api/brain/tasks 入口增 artifact_kind + answer_known 并按四格路由

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（Crystal Harness 第 1 件落地，任务入口具备四格分流能力）

## 背景

决策 d95275f2 定名第四代 Harness = Crystal Harness，coding 是骨架上的一条 value stream，内含四档变体。
决策 ca9f3d7b（Skill-DisCo 路线）+ 28ca1f69（蒸馏五步循环）确立：任务按"产物形态 × 答案是否已知"分流——
可逆/已知走确定性代码路径，未知/探索走 LLM 探索路径。本 sprint 是该架构的入口件：在 `POST /api/brain/tasks`
创建任务时给任务打上 `artifact_kind` 与 `answer_known` 两个维度，并按四格路由到对应处理路线。

## Golden Path（核心场景）

系统从 [任务经 POST /api/brain/tasks 创建] → 经过 [两维分类 + 四格判定] → 到达 [任务被打上分格标签并进入对应路线]

具体：
1. 一个新任务通过 `POST /api/brain/tasks` 进入 Brain（携带 title/description/payload）。
2. 系统用**规则**判定 `artifact_kind`，取值 `code`（产物是代码）或 `execution`（产物是执行动作）。
3. 系统用**一次 LLM 调用**判定 `answer_known`，取值 `true`（答案/做法已知）或 `false`（需探索）。
4. 系统按 (`artifact_kind`, `answer_known`) 四格路由，落一个可观测的 `routed_lane`：
   - `code` + `known` → `/dev`
   - `code` + `unknown` → 原型 → `/dev`
   - `execution` + `known` → 画布 + skill
   - `execution` + `unknown` → skill 探索
5. 出口：任务记录上可读到 `artifact_kind`、`answer_known`、`routed_lane` 三个字段，任务进入对应路线。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- LLM 判 `answer_known` 调用超时/报错：必须有确定性兜底取值（不得让任务卡在无 lane 状态），并写 Brain log。
- description 为空：`artifact_kind` 规则仍须给出确定取值，不得抛异常中断任务创建。
- 四格互斥完备：任一任务必须命中且仅命中一格，禁止出现无 lane 或多 lane。

## 范围限定

**在范围内**：`POST /api/brain/tasks` 入口新增 `artifact_kind`（规则判）+ `answer_known`（LLM 一次调用判）两字段；四格 → lane 的路由逻辑；最近 30 个真实任务的回放分格准确率报告。
**不在范围内**：下游各 lane（/dev、原型、画布、skill 探索）本身的实现；skill 蒸馏五步循环；registry/契约固化；对历史存量任务的批量回填。

## 假设

- [ASSUMPTION: `artifact_kind`/`answer_known`/`routed_lane` 作为任务字段（payload 或列）持久化，具体存储形态由 Proposer 读 schema 决定]
- [ASSUMPTION: "回放最近 30 个真实任务"取 tasks 表最近 30 条真实（非 smoke）任务，人工/既有标注作为准确率基准]
- [ASSUMPTION: LLM 判 `answer_known` 用 Brain 既有 LLM 调用通道，单次调用，不引入新依赖]

## 预期受影响文件

- `packages/brain/src/task-router.js`: 任务入口路由，四格 → lane 判定与 `artifact_kind` 规则判定挂载点
- `packages/brain/src/server.js`: `POST /api/brain/tasks` 入口，接线两维分类
- `packages/brain/src/`（LLM 调用相关模块）: `answer_known` 的一次 LLM 调用判定

## NFR 约束

<!-- 来源: decisions category=nfr（step+feature 均空）+ PrepPRD（thin_prd 未显式指定）；双源均无值 → 待定 -->
- 超时/延迟: 待定（PrepPRD 未指定；LLM 判定须有超时兜底，见边界情况）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 四格路由结果（artifact_kind/answer_known/routed_lane）与 LLM 判定失败必须写 Brain log

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature/journey 三源均空）；注入系统级铁律 + 本任务直接相关项 -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [凭据安全] API Key/Token/密钥不入 git（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [新task_type七点] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR 等逐点核对（来源: area）
- [target_env读payload] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 下仅有 planned ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + psql）
# 期望验收点（自然语言）：
# 1) POST localhost:5221/api/brain/tasks 创建任务后，任务记录含 artifact_kind∈{code,execution} 且 answer_known∈{true,false}。
# 2) 四种 (artifact_kind, answer_known) 组合各命中唯一正确 routed_lane（code+known→/dev；code+unknown→原型→/dev；execution+known→画布+skill；execution+unknown→skill探索）。
# 3) 回放最近 30 个真实任务，产出分格准确率报告（每格命中数/总数 + 整体准确率），报告为真实产物可查。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/（POST /api/brain/tasks 入口路由），纯后端自主流程，无 UI/远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 纯 Brain API/后台逻辑，E2E 在本地 evaluator 用 curl localhost:5221 + psql 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
