# Sprint PRD — Harness Cockpit Phase 3：决策面板（让决策可见可改可点火）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测与可控（cockpit 全生命周期可见 → 可决策）
- **当前进度**：Phase 1（完整 PrepPRD 显示，#3395）+ Phase 2（read-only 全生命周期，#3400）已合
- **本次推进预期**：从"只能看"到"能改决策 + 能点火"

## 背景

Cockpit 已能一页看完一个 pipeline 的全部产物（Phase 2 read-only）。Phase 3 让其中的**决策清单**从只读变成可写：决策能落库、能在 cockpit 改、确认后能点火 harness_initiative。这是 PrepPRD 四支柱里「② 多轮收敛」「③ 默认+例外覆盖」「④ inline↔无头↔共享白板靠 decisions 表同步」的 cockpit 落地。本刀仅 cecelia repo 部分；/dev skill 决策扫描另走 skill-creator，不在本刀。

## Golden Path（核心场景）

**场景 A — 写一轮决策落库（Brain 端点）**
1. 调用方 POST `/api/brain/dev/decisions`，body 含一条决策（topic/decision/默认值 + `level`/`target`/`scope`/`verify_layer`/`round`/`generated_by`）
2. 系统 append（不覆盖）写入 `decisions` 表
3. 查 DB：该行存在，上述字段值与请求一致

**场景 B — 确认决策后点火（Brain 端点）**
1. 调用方 POST `/api/brain/dev/submit`（带要点火的 pipeline/target 标识）
2. 系统复用现有建任务逻辑，创建一条 `task_type=harness_initiative` 的任务
3. 查 DB：新 harness_initiative 任务存在

**场景 C — cockpit 决策面板可见可改可再来一轮（UI，接 Phase 2 详情页）**
1. 用户打开某 pipeline 详情页 → 决策面板查 `decisions WHERE target=该 pipeline 的 ability/step`
2. 面板列出每条决策：topic / decision / 默认值 / verify_layer / round；每条可编辑 + 可标 `v1`/`backlog`
3. 用户改一条 → 写回 decisions 表（落库成功，刷新可见新值）
4. 用户点「再来一轮」按钮（本刀先 stub）→ POST 一条 `round+1` 的占位决策 → 面板可见 round 增长（后续接无头红队 agent）

## 边界情况

- decisions append 语义：再来一轮/改决策不得覆盖历史 round，只追加或更新指定行
- target 为空 / 无匹配决策 → 面板显示空态，不报错
- submit 缺必填标识 → 返回 4xx，不建出脏任务

## 范围限定

**在范围内**：上述两个 Brain 端点（decisions 写入 / submit 点火）+ cockpit 决策面板 UI（列出/编辑/标记/再来一轮 stub）
**不在范围内**：/dev skill 的决策扫描前移（走 skill-creator）；无头红队 agent 真实实现（本刀「再来一轮」仅 stub round+1）；Phase 4 题库 `decision_catalog`；Notion 同步

## 假设

- [ASSUMPTION: `decisions` 表已含 level/target/scope/verify_layer/round/generated_by 字段（#3391 已合并、线上活）；如缺字段需先补 migration]
- [ASSUMPTION: 「再来一轮」本刀仅 POST 占位 round+1 决策行，不 spawn agent；面板靠轮询/刷新看到 round 变化]
- [ASSUMPTION: cockpit 决策面板接进 Phase 2 已有的 pipeline 详情页（TaskPrdPage 扩展），不新建路由]

## 预期受影响文件

- `packages/brain/src/`（routes/server）：新增 `POST /api/brain/dev/decisions` + `POST /api/brain/dev/submit`
- `packages/brain/`：decisions 查询/写入逻辑（按 target 过滤、append round）
- `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx`（或其决策面板子组件）：决策清单展示 + 编辑 + 标记 + 再来一轮按钮
- `apps/dashboard/src/`：调用上述 Brain 端点的 API 层
- 对应 failing test（先写）：Brain 端点测试 + dashboard 决策面板测试

## E2E 验收

> Planner 初稿占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=mac_web 产出（curl 验 Brain 端点 + psql 查 DB + Playwright 驱动决策面板）。

```bash
# 占位：proposer 按 target_environment=mac_web 填入真实脚本
# 期望验收点（自然语言）：
# (a) curl POST /api/brain/dev/decisions 写一条决策 → psql 查 decisions 表存在该行且 level/target/scope/verify_layer/round/generated_by 字段正确
# (b) curl POST /api/brain/dev/submit → psql 查出新建的 harness_initiative 任务
# (c) Playwright 打开某 pipeline 详情页 → 决策面板显示该 pipeline 决策清单 → 改一条 → 落库且页面刷新可见新值 → 点「再来一轮」→ 面板可见 round+1
```

## journey_type: dev_pipeline
## journey_type_reason: 本刀核心是 harness/dev 基础设施（决策端点 + cockpit 决策面板），服务开发流水线本身；虽涉及 dashboard 但产物归属 dev_pipeline 能力轴
## target_environment: mac_web
## target_environment_reason: 验收含 cockpit 决策面板的浏览器交互（编辑/再来一轮），走本机 Playwright localhost:5174/5174；Brain 端点用 curl+psql 在同环境验证
## journey_id: <来源 task.payload.journey_id（/dev 路径 C 点火写入）；本 repo 为 Cecelia Line 唯一 = Harness Pipeline>
## step_id: <Cockpit Phase 3 — 决策面板（接 Phase 2 详情页）；来源 = PrepPRD Golden Path 锚定>
