# Sprint PRD — kernel 真读 gear：三档在 orchestrator 状态机内分流

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+2%（harness gear 三档在 kernel 上真正生效，是强制入口交付物 4 的前置件之一）

## 背景

kernel runtime（`packages/brain/src/orchestrator/`，75 个文件）目前完全不读 `payload.gear`——全目录 grep gear = 0 命中。gear 只被注进旧 relay 路径的 prompt/env（harness-skill-relay.js）由 harness-controller/SKILL.md 提示词消费；kernel 走 `orchestrator/derive.js` 纯函数状态机，不读 controller SKILL。后果：kernel 跑的每一条都是裸 default，harness gear 三档在 kernel 上形同虚设（近 30 天 kernel-v1 跑 192 条，标 gear=hotfix 的 1 条也没被读、segmented 0 条）。
法源：决策 1b677ae3（四线四档融合）+ 决策 e8f6134f（三条边界拍板）。串行四交付物的第 1 件——"kernel 真读 gear、三档在 orchestrator 状态机内分流"。

## Golden Path（核心场景）

系统从 [kernel run 启动读 gear] → 经过 [derive.js 状态机按 gear 分叉] → 到达 [initiative_attempts 的 role 分布随 gear 可观测变化]

具体：
1. kernel 进程（`orchestrator/run.js`）启动时从 `task.payload.gear` 读 gear，缺省/null → `default`，非法值 → 在 kernel 侧 fail-closed（terminal failed，reason=`invalid_gear`，处理形态对齐 `executor.js:3090`），合法值 → 读进 kernel run context 并持久化到 `initiative_runs`，进程启动时可查。
2. `derive.js` 纯函数状态机在初始态按 gear 分叉：
   - `gear=default`：现行为一字不改，初始态仍 `spawn:planner`（零回归）。
   - `gear=hotfix`：跳过 planning/gan 相位，初始态直接进 generate（返回 action 不等于 `spawn:planner`），保留 generator→evaluator→judge（决策 1b677ae3 原文：免 planner/GAN 但保留评估）。
   - `gear=segmented`：分段执行，语义对齐 harness-controller/SKILL.md:279-291 既有 segmented 定义（planner 照跑 → proposer 透传多段 task-plan → 分段串行点绿）。
3. 可观测结果：跑一条 kernel run 后，`initiative_attempts` 表按 role 计数——hotfix run 无 planner/proposer/reviewer 记录、有 generator；default run 三者齐全。

## 边界情况

- gear 缺省 / null → 归一为 `default`，行为与现行完全一致（零回归）。
- gear 非法值（如 `turbo`）→ kernel 侧 fail-closed，标 terminal failed reason=`invalid_gear`，不 spawn 任何相位。
- gear 枚举唯一真相为 `harness-skill-relay.js` 的 `GEAR_VALUES=['default','hotfix','segmented']`，kernel 不新建平行枚举。
- segmented 段循环不新增 Brain 任务，不改 dispatcher 并发模型。

## 范围限定

**在范围内**：`gear=default/hotfix/segmented` 三档在 `orchestrator/run.js`（读取+持久化 initiative_runs）与 `orchestrator/derive.js`（初始态分叉）内落地；非法 gear kernel 侧 fail-closed。
**不在范围内**：`gear=param` 档（独立交付物 3）；入口强制 / `/dev` 改点火器 / POST /tasks fail-closed（交付物 4）；不动 relay 路径与 controller SKILL。

## 假设

- [ASSUMPTION: kernel 复用 `harness-skill-relay.js` 的 `deriveGear` + `GEAR_VALUES` 作为唯一 gear 枚举 SSOT，只读复用，不改其实现]
- [ASSUMPTION: `initiative_runs` 通过新增列或 run_context JSON 持久化 gear，供 kernel 进程启动时查询]
- [ASSUMPTION: hotfix/default 分叉点在 `derive()` 初始态（run 未起步、prdExists=false 时），只影响入口相位选择，不改 fix 循环内既有路由]

## 预期受影响文件

- `packages/brain/src/orchestrator/run.js`：启动读 `payload.gear` 进 run context + 持久化 `initiative_runs`。
- `packages/brain/src/orchestrator/derive.js`：初始态按 gear 分叉（hotfix 跳 planning/gan、segmented 分段、default 不变、非法 fail-closed）。
- `packages/brain/src/orchestrator/__tests__/`：新增 `derive()` gear 分叉单测（永久保留为回归）。
- `packages/brain/src/harness-skill-relay.js`：只读复用 `deriveGear`/`GEAR_VALUES`（不改实现）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空）+ PrepPRD；无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: gear 分叉结果必须落 `initiative_attempts` role 计数，可 psql 查证（本 sprint 的验收即以此为准）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 级本任务为空） -->
- [零回归] gear=default 现行为一字不改（来源: 决策 e8f6134f/1b677ae3）
- [枚举单源] gear 合法集唯一真相=GEAR_VALUES，非法值全链 fail-closed（来源: 决策 e8f6134f）
- [local_api 验证] local_api / 无 UI smoke 任务需在合同内声明 psql 证据消费，避免 judge meta_verification_gap 死锁（来源: area）
- [证据实跑] 合同验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也需核实（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史 ability，golden-paths 仅有 planned 态 ability）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl+psql）
# 期望验收点（自然语言）：
# 1. psql：跑一条 gear=hotfix 的 kernel run，查 initiative_attempts，
#    role IN ('planner','proposer','reviewer') 记录数 = 0 且 role='generator' 记录数 >= 1
# 2. psql：同条件 gear=default 的 run，planner/proposer/reviewer 三者记录数均 >= 1
# 3. 单测：derive() 喂 gear=hotfix 的 observed 初始态，返回 action 不等于 spawn:planner
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/src/orchestrator/（纯后端状态机），无 UI/无远端 agent 协议/非 engine hooks。
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部 kernel 状态机，验收靠本地 evaluator（curl localhost:5221 + psql），payload 已显式指定 local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
