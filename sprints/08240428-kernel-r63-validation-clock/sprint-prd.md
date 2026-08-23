# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：降低健康长跑 Harness run 被误判超时的风险，不虚构百分比增量

## 背景

`resolveValidationClock` 当前从 `spawn:generator` 起固定计算 pipeline deadline。经历多个 fix 轮但仍健康推进的 run 会撞上旧原点的 `timeout_seconds`（默认 5400 秒）而被误杀；r50/r51 曾需数据库手术续命。本 Sprint 修复 kernel validation clock 不随 fix 轮顺延导致长跑 run 被误杀的问题，同时保持超时保护有界、可重放。

Unified Map 未配置：task payload 提供 `map_scope=["F1"]`，但缺少 `map_repo`，因此不猜测当前地图 revision。权威实现基线固定为 `09d1a044c94f888ea365759dbfbe947a4f5f4801`。

## Golden Path（核心场景）

编排系统从已有 `spawn:generator` 与后续决策日志进入 validation clock 计算 → 按 hop 时序识别成功派发的 `spawn:generator-fix` → 最多以 6 次 fix 派发作为新原点重算同一 `timeout_seconds` → 输出当前 run 存活或超时的确定结论。

具体：
1. 给定 r50 类日志：初始 generator 原点已超过 deadline，但最近一次成功 `spawn:generator-fix` 后仍在时限内，系统判定 run 存活。
2. 每次成功 `spawn:generator-fix` 将 pipeline deadline 原点更新为该行为；只依赖 `orchestrator_decision_log` 行及其 hop 时序，相同输入可重放出相同结果。
3. 最多接受 6 次顺延；出现第 7 次或更多 fix 轮时不再顺延，超过有效 deadline 后照常判死。
4. 没有 fix 轮的日志保持现有 `spawn:generator` 原点与既有存活/超时语义。

## 边界情况

- 没有 `spawn:generator-fix`：行为与当前版本一致。
- 恰好 6 次成功 fix 派发：第 6 次可成为新原点；超过上限不得继续延寿。
- 超过 6 次 fix 派发：不因第 7 次及后续行为刷新 deadline，超时后判死。
- 仅日志行存在但未表达派发成功：不得作为新原点。
- 输入顺序以 hop 时序解释；函数不读取当前数据库状态或其他隐式状态。

## 范围限定

**在范围内**：pipeline validation clock 的 fix 轮有界顺延；r50 场景 RED 回归；超限与无 fix 轮负向测试；冻结测试真实 import 被改模块；登记真实 `loop.js` 接缝未覆盖项；合同四件套在后续 propose 分支真实落盘并提交。

**不在范围内**：修改 `timeout_seconds` 默认值；修改人审 deadline；宣称本 Sprint 已覆盖 `loop.js` 真实集成链路；依赖日志之外的可变状态。

## 假设

- [ASSUMPTION: “派发成功”以 `orchestrator_decision_log` 中既有成功决策语义判定，具体字段由 Proposer 基于当前契约冻结，不新增替代数据源。]
- [ASSUMPTION: 上限 6 次是每个 pipeline validation clock 生命周期内可用于刷新原点的成功 fix 派发总数。]
- [ASSUMPTION: 第 7 次及后续 fix 不改变第 6 次已形成的有效 deadline。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：用户可观察的 validation clock 判定行为发生变化。
- `tests/gp/f1/` 下冻结测试：复刻 r50、超限和无 fix 轮行为，真实 import 被改模块且不 mock 被改边。
- `packages/brain/DEFINITION.md`：Brain 源码变更按仓库门禁同步版本定义。
- `sprints/08240428-kernel-r63-validation-clock/contract-draft.md`、`contract-dod.md` 与 `tests/`：由 Proposer 创建并冻结可执行合同与测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：保留 `timeout_seconds` 既有值与默认 5400 秒，仅改变合格 fix 轮后的计算原点。
- 频控：顺延上限 6 次，超过上限不得继续刷新 deadline。
- 版本要求：待定（PrepPRD 未指定）。
- 可观测：纯函数只依赖决策日志行及 hop 时序，相同输入必须得到相同结果；无隐式数据库读取。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/feature 为空，area 返回 89 条，按 id 去重；以下为与本 scope 有直接约束关系的可执行归并，完整源已在 Planner 采集阶段读取 -->
- [重试身份] generator infrastructure retry 必须保持既有 identity 语义（来源: area）
- [Planner分支] Planner 只在服务端签发分支产出合同（来源: area）
- [Brain权威URL] Fleet Generator 使用 Brain URL 权威来源，禁止写死环境假设值（来源: area）
- [时钟接入] Kernel 已有 PR evaluator 必须采用 validation clock（来源: area）
- [证据窗口] judge 证据必须在消费窗口内提供一手 root oracle（来源: area）
- [命令真跑] 合同验证命令必须真实执行并确认 exit code 语义（来源: area）
- [测试质量] 冻结测试必须真实 import 被改模块，禁止 mock 被改边（来源: area）
- [环境真验] 真实环境验证才算完成（来源: area）
- [单槽串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [凭据安全] 凭据不得写入日志或版本库（来源: area）
- [日志脱敏] 可观测输出不得泄露敏感信息（来源: area）
- [租户隔离] 系统数据保持租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 的 golden-paths -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：冻结测试真实 import validation-clock.js；r50 类输入从旧判死变为新存活；第 7 次后超时判死；无 fix 轮语义不变；并确认真实 loop.js 集成接缝被登记为未覆盖而非假报覆盖。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 provider 无关编排内核，属于纯后端自主决策行为。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，由本地 evaluator 对 Brain 纯函数与冻结测试执行验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
