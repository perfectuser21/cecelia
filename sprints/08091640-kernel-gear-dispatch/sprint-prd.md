# Sprint PRD — kernel 真读 gear：三档在 orchestrator 状态机内分流

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness gear 三档在 kernel 上从"形同虚设"变为真分流）

## 背景

kernel runtime（`packages/brain/src/orchestrator/`，75 个文件）目前完全不读 `payload.gear`——全目录 grep gear = 0 命中。gear 只被注进旧 relay 路径的 prompt/env（`harness-skill-relay.js:581,636`），由 `harness-controller/SKILL.md:143` 这个提示词消费；kernel 走 `orchestrator/derive.js` 纯函数状态机，不读 controller SKILL。后果：kernel 跑的每一条都是裸 default，近 30 天 kernel-v1 跑 192 条，标 gear=hotfix 的 1 条也没被读、segmented 0 条。
法源：决策 1b677ae3（四线四档融合）+ 决策 e8f6134f-4131-4145-a893-79eb098011d9（三条边界拍板）。

## Golden Path（核心场景）

系统从 [Brain 派发带 gear 的 harness_initiative] → 经过 [kernel 读 gear 入 run context + derive 按档分叉] → 到达 [initiative_attempts 里三档角色分布可 psql 验证]

具体：
1. Brain 派发 `harness_initiative`（`payload.orchestrator=skill-relay`，`payload.gear=hotfix|segmented|default`），kernel 进程 `orchestrator/run.js` 启动。
2. `run.js` 从 `task.payload` 读出 gear（复用 `harness-skill-relay.js` 既有 `deriveGear`），写入 kernel run context，并持久化到 `initiative_runs`（新增 `gear` 列），kernel 进程启动时可查。
3. `derive.js` 状态机每轮 reconcile 时读 run context 的 gear 分叉：
   - **gear=hotfix**：初始态（`prdExists=false`）不再返回 `spawn:planner`，跳过 planning/gan 相位直接进 generate，保留 generator→evaluator→judge（决策 1b677ae3 原文：免 planner/GAN 但保留评估）。
   - **gear=segmented**：分段执行，语义对齐 `harness-controller/SKILL.md:279-291` 既有 segmented 定义（planner 照跑 → proposer 输出多段 task-plan.json → N 段串行点绿）。
   - **gear=default**：现行为一字不改（零回归）。
4. 非法 gear（不在 `GEAR_VALUES` 枚举）在 kernel 侧 fail-closed，处理形态对齐 `executor.js:3097` 的 `invalid_gear` terminal failed。
5. 可观测出口：psql 查 `initiative_attempts`，hotfix run 无 planner/proposer/reviewer 记录且有 generator；default run 三者齐全。

## 边界情况

- gear 缺失/undefined/null → 按 `deriveGear` 既有语义降级为 default，行为与现行完全一致。
- 非法 gear 值（如 turbo）→ kernel 侧 terminal failed，不静默降级、不进任何相位。
- default 档必须与改动前逐字节等价（derive 分叉只在 gear≠default 时生效）。

## 范围限定

**在范围内**：`gear` 从 payload 读入 kernel run context + 持久化 initiative_runs；`derive.js` 按 hotfix/segmented/default 三档分叉；非法 gear 在 kernel 侧 fail-closed。
**不在范围内**：不建 `gear=param` 档（独立交付物 3）；不动入口强制（交付物 4）；不改旧 relay 路径 prompt/env 注入；不改 `harness-controller/SKILL.md`。

## 假设

- [ASSUMPTION: `initiative_runs` 表当前无 `gear` 列，需新增迁移（migrations 目录序号续 393 之后）]
- [ASSUMPTION: kernel run context 里 gear 由 `run.js` 一次读入后透传给 `derive.js` 的 observed，而非 derive 每轮重查 DB]
- [ASSUMPTION: segmented 在 kernel 侧的"分段"以决策语义对齐为准；若 kernel 主线无多段执行原语，本 sprint 至少保证 gear 被读入并可分叉判定，段循环细节留待实现阶段按 controller 语义落地]

## 预期受影响文件

- `packages/brain/src/orchestrator/run.js`: 从 task.payload 读 gear 入 run context
- `packages/brain/src/orchestrator/derive.js`: 状态机按 gear 分叉（hotfix 跳 planning→generate；default 不变）
- `packages/brain/src/orchestrator/kernel-run-store.js`: initiative_runs INSERT 增写 gear
- `packages/brain/migrations/394+_*.sql`: initiative_runs 新增 gear 列
- `packages/brain/src/harness-skill-relay.js`: 复用 `deriveGear`/`GEAR_VALUES`（只读，非法值 throw 语义对齐）
- `packages/brain/src/orchestrator/__tests__/`: derive() 喂 gear=hotfix 初始态的单测

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 零回归: gear=default 行为必须与改动前逐字节等价（决策 1b677ae3 原文"现行为一字不改"）
- fail-closed: 非法 gear 必须 terminal failed，禁止静默降级（对齐 executor.js:3097）
- 确定性: derive.js 分叉逻辑禁 Date.now/Math.random/new Date，缺字段 fail-fast（derive.js 既有纪律）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本 line step/feature 级为空，area 级仅 capture-triage learning 日志非硬铁律 -->
- [零回归] gear=default 分支不得改变现行 derive 输出（来源: 决策 1b677ae3）
- [fail-closed] 非法 gear 在 kernel 侧不得静默放行，须 terminal failed（来源: 决策 e8f6134f 边界拍板）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无 done/working 状态的已验收 ability 历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl+psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
#  1. 跑一条 gear=hotfix 的 kernel run → psql 查 initiative_attempts：
#     role IN ('planner','proposer','reviewer') 记录数 = 0 且 role='generator' 记录数 >= 1
#  2. 同条件 gear=default 的 run → planner/proposer/reviewer 三者记录数均 >= 1
#  3. 单测：derive() 喂 gear=hotfix 的 observed 初始态（prdExists=false），返回 action != 'spawn:planner'
#  4. 非法 gear（如 turbo）→ kernel 侧 terminal failed，reason=invalid_gear
```

## journey_type: autonomous
## journey_type_reason: 改动仅涉 packages/brain/src/orchestrator/ 纯后端状态机，无 UI/agent 协议/engine 路径
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端，验收靠本地 evaluator（curl localhost:5221 + psql 查 initiative_attempts）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116
