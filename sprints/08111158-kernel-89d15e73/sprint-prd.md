# Sprint PRD — coding 路由收归 kernel：改代码任务派发时打标强制进 harness

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（改代码任务全部纳入 kernel harness 裁决线，堵死绕过 evaluator+judge 的 legacy dev spawn）

## 背景

Alex 拍板（决策 bf361265，2026-08-11）：任何执行体在启动/派发时刻由 Brain 识别是否改代码；凡改代码一律打标并强制路由进 kernel harness 自动 coding 线，不再依赖各执行体 hooks/AGENTS.md 自觉。

现状：Brain 识别改代码后标 `task_type=dev`，在 `dispatcher.js` 走 `triggerCeceliaRun` legacy 本地 spawn 链，与 kernel 平行、不经 evaluator+judge 裁决（实证 P1 Universal Map dev 任务全程绕 kernel）。本 sprint 只收归 Brain 派发层 + 打标；有头 hook 改造与 merge 兜底闸（任务 51740e13）不在本次范围。

## Golden Path（核心场景）

系统从 [Brain tick 选中改代码任务] → 经过 [派发层打标 + kernel 分流] → 到达 [initiative_runs 出现 kernel run，legacy spawn 未触发]

具体：
1. Brain tick 选中一个 `task_type=dev`（或被判定为改代码）的任务准备派发。
2. 派发层在 spawn 前识别"改代码"（先用 task_type 白名单：dev/bugfix 类，留扩展点），落 payload 标记 `code_change=true` + `gear`（按体量：bug/小改动=hotfix 或 default，大功能=deep），并路由到 kernel harness 通道（走 harness_initiative full-graph spawn），**不再调用 `triggerCeceliaRun` legacy spawn**。
3. 可观测结果：该任务在 `initiative_runs` 产生一条 run 记录（进入 evaluator+judge 裁决线）；对应 legacy `cecelia-run` spawn 未被触发。

对照：`task_type` 非改代码类（research/arch_review/talk/data 等）派发行为**不变**，仍走原通道。

## 边界情况

- A/B 路径任务（07-08 前走 legacy 轻量链例外）本次也收归进 kernel，不再例外。
- `gear` 缺省取 `default`；识别规则命中白名单即打标，白名单外任务视为非改代码。
- 同一改代码任务被重复派发时打标幂等，不产生重复 kernel run。

## 范围限定

**在范围内**：`dispatcher.js` / `task-router.js` 派发层的改代码识别、`code_change`+`gear` 打标、kernel harness 分流；改代码任务对 legacy dev spawn 关闭。
**不在范围内**：merge 裁决闸（任务 51740e13 负责）；有头会话 hook / AGENTS.md 入口改造（拆后续任务）；codex/grok provider 语义不动。

## 假设

- [ASSUMPTION: 改代码判定第一版以 task_type 白名单（dev/bugfix 类）实现，`code_change` 显式标记作为扩展点保留。]
- [ASSUMPTION: kernel harness 通道复用现有 harness_initiative full-graph Docker spawn 路径，无需新建 spawn 机制。]
- [ASSUMPTION: 本任务依赖任务 356449b7（kernel 账号选择接用量，同改 dispatcher.js）已合并（#4789 已在 base_sha 内），故 blocked 前置已解除。]

## 预期受影响文件

- `packages/brain/src/dispatcher.js`: spawn 分流点（`triggerCeceliaRun` 调用前）加改代码识别 + kernel 路由分支，改代码任务关闭 legacy spawn。
- `packages/brain/src/task-router.js`: 改代码 task_type 白名单 / `code_change`+`gear` 打标规则。
- `packages/brain/test/`（或 `packages/quality/`）对应 dispatcher/orchestrator 测试：新增打标+分流断言，保留现有回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 line 无值），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 打标幂等，同任务不产生重复 kernel run
- 版本要求: 无
- 可观测: 派发分流决策与打标结果需可从 initiative_runs / task_events 观测

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [不动merge闸] 本 sprint 不改 merge 裁决闸，兜底闸归任务 51740e13（来源: PrepPRD 边界）
- [不动provider] 不改 codex/grok provider 语义（来源: PrepPRD 边界）
- [非改代码不受影响] 非改代码 task_type 派发行为必须保持不变（来源: PrepPRD 验收方向）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql/vitest）。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest 单测 + psql/curl 断言）
# 期望验收点（自然语言）：
# 1. 派发一个 task_type=dev 且判定为改代码的 fixture 任务 → 断言 initiative_runs 出现该任务的 run 记录（进入 kernel 裁决线），且 triggerCeceliaRun legacy spawn 未被调用；payload 已落 code_change=true + gear。
# 2. 派发一个非改代码 task_type（如 research/arch_review）→ 断言派发通道与打标行为与收归前一致（不进 kernel、不打 code_change）。
# 3. 回归：现有 orchestrator/dispatcher 测试全绿。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 派发层（dispatcher/task-router），纯后端调度逻辑，无 UI/远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端派发逻辑，E2E 在本地 evaluator 用 vitest 单测 + curl localhost:5221 / psql 验证 initiative_runs。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
