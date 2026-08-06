# Sprint PRD — 修复 ledger-hygiene m2「归属完整率」口径失真，让守卫不再对噪声报 P1

## OKR 对齐

- **对应 KR**：O2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（守卫指标可信度修复）

## 背景

ledger-hygiene m2「归属完整率」欠账连续 3 天棘轮击穿（454→459）升 P1。调研（.harness/research-ledger-hygiene.md）结论：本次 +5 是冒烟测试噪声而非真实归属退化。m2 口径存在三处失真：① attribution_harness 子指标未接线恒空（tasks.ability_id 全库仅 15 行非空，该子项=纯噪声源）；② 守卫自噬回路（守卫自产 issue/task 无排除，每报一次自涨 3，m7 已有 LEDGER_SELF_ATOM_PREFIX 排除而 m2 没有）；③ harness_initiative 同时缺 journey_id 与 ability_id 时被双重计数。本 sprint thin-slice = 修 m2 口径让指标可信。

## Golden Path（核心场景）

系统从 [守卫例行计算 m2] → 经过 [修正后的口径排除三类失真] → 到达 [debt 反映真实归属欠账，噪声不再触发 P1]

具体：
1. [触发条件] Brain 例行运行 ledger-hygiene 守卫计算 m2「归属完整率」欠账（只读复现入口：`node packages/brain/scripts/smoke-ledger-hygiene.mjs`）
2. [系统处理] m2 debt 只统计真实归属缺失：
   - 排除守卫自产：`[ledger-hygiene]%` 前缀 issue 与 `[紧急] issue: [ledger-hygiene]%` 前缀 task 不计入（复用 LEDGER_SELF_ATOM_PREFIX 共享常量模式，参照 m7 既有排除）
   - 排除冒烟噪声：headed 派发冒烟脚本建的测试 task 带机器可识别标记，m2 子查询按标记排除
   - attribution_harness 子指标（tasks.ability_id IS NULL）在字段接线前不计入 m2 求和，同一任务不再被双重计数
3. [可观测结果] m2 debt 回落到真实欠账水平；跑一次 headed 冒烟派发后重算 m2，debt 不因 smoke task 上升；守卫不再因自产/冒烟噪声开 P1 击穿 issue

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 口径修正后 debt 骤降：棘轮（evaluateRatchet）只对上升击穿，骤降不误报；不重置 baseline
- 排除条件必须精确匹配自产前缀/冒烟标记，不得误伤真实业务 task/issue（真实归属缺失仍必须被捕捉）
- 存量无标记的历史冒烟 task 不回填，随 7 天滚动窗自然滚出
- attribution_harness 禁用后若未来 ability_id 接线，恢复该子项属后续 sprint，本次只在代码注释注明

## 范围限定

**在范围内**：m2 三条子查询口径修正（自产排除/冒烟标记排除/attribution_harness 停计与双重计数消除）；冒烟派发脚本建 task 加标记；复现失真的回归测试（先 failing test 后修，测试永久进 CI）
**不在范围内**：guard-drill 频控（调研 P0#2，另立后续）；三处写入侧硬编码 journey_id NULL 的上牙（P1）；历史数据回填（P2）；棘轮死区/比率化与 m2 时间窗机制改造（P2）；ability_id 真实接线

## 假设

- [ASSUMPTION: attribution_harness 子指标采取"接线前停计"而非"本次接线"——接线属更大改动，超 thin-slice]
- [ASSUMPTION: 冒烟标记具体形态（payload 字段或 title 前缀）由 Proposer 依据现有 smoke 脚本建 task 方式确定]
- [ASSUMPTION: 本 sprint 不改 m2 的 7 天滚动窗机制；「探针用确定性日历窗口」invariant 适用于新建探针，存量窗口改造记入后续]

## 预期受影响文件

- `packages/brain/src/ledger-hygiene.js`: m2 三条子查询口径修正（:83-109），复用自产排除常量（:26, :217-218 模式）
- `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`、`.../claude-headed-dispatch-smoke.sh`: 建 task 携带冒烟标记
- `packages/brain/tests/`（或既有测试目录）: m2 口径回归测试（复现三处失真的 failing test）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两级均为空数组），以下为任务上下文自带约束 -->
- DevGate：改动 packages/brain 前须过 `facts-check.mjs` / `check-version-sync.sh` / `check-dod-mapping.cjs`，由 Generator 阶段执行，PRD 如实标注
- Bug Fix 流程：先写能复现失真的 failing test，修复后测试作为回归测试永久保留 CI，不可删
- 可观测：修正后 m2 各子项 debt 构成可通过只读脚本 `smoke-ledger-hygiene.mjs` 复核
- 超时/频控/版本要求: 待定（PrepPRD 未指定，decisions 无值）
- 后续记账（超 thin-slice，不在本 sprint）：guard-drill 当日去重频控、写入侧 journey 兜底上牙、棘轮死区

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两级为空，area 级 75 条中甄别出以下真铁律；
     其余 60+ 条为 [capture-triage]/[agent-offline-alert] learning 混入与 smoke-invariant-* 测试噪声（恰为本 sprint 治理的同类污染），不作为铁律注入 -->
- [串行执行] 一个 slot/会话内严格串行执行任务，并行只许跨 slot（来源: area）
- [禁写死环境值] 屏幕坐标/阈值/假设调用方传值等环境假设值禁止写死，从环境推导或真机校准（来源: area）
- [真环境验证] 依赖真机/生产 env 的接缝断言必须在真目标上验证过才算 done，未真验只能标 logic-done-pending（来源: area）
- [测试多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，绝不混读/混写（来源: area）
- [设备类型审查] 多设备类型 UI 区分必须在设计/审查阶段强制检查；字段语义重叠须本 sprint 消解或建正式 decision（来源: area）
- [自产数据排除] 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染（来源: area，本 sprint 核心依据）
- [日历窗口] 探针类时间窗口用确定性日历窗口而非 NOW()-interval 滑动窗，防秒级漂移重复计账/漏计（来源: area，存量 m2 窗口改造见假设 3）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: task.payload 无 journey_id（issue 直派任务，非路径 C 点火），无法拉取 line 级 golden_path -->
（本 line 暂无历史）

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 按 target_environment=local_api（curl+psql/node）产出。

```bash
# 占位：proposer 将按 local_api 模板填入真实脚本
# 期望验收点（自然语言）：
# 1. 基线：运行只读复现脚本记录 m2 debt = D0
# 2. 注入噪声：建 1 条带冒烟标记的 harness_initiative task、1 条 "[紧急] issue: [ledger-hygiene]%" task、1 条 "[ledger-hygiene]%" issue（journey_id NULL）
# 3. 重算 m2 debt = D1，断言 D1 == D0（三类噪声全部被排除，守卫不因噪声涨账）
# 4. 注入 1 条真实归属缺失 task（无冒烟标记、无 journey_id）→ 重算 D2 == D0 + 1（真实退化仍被捕捉，排除不误伤）
# 5. 断言 attribution_harness 子项不再计入 m2 求和（修正前该子项恒等于分母）
# 6. 测试数据清理 + 回归测试进 CI
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 守卫指标计算与冒烟脚本，纯后端无 UI/agent 协议/engine
## target_environment: local_api
## target_environment_reason: Brain 内部指标口径修复，本地 evaluator 用 node 脚本 + psql（localhost:5221 / cecelia 库）即可端到端验证
## journey_id: none
## step_id: none（PrepPRD 未锚定）
