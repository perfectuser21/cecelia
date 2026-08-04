# Sprint PRD — ledger-hygiene m7「自主循环零产出」探针可信化（消除自指计数与滑动窗秒级竞态）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（账本保鲜守卫指标去误报，告警可信）

## 背景

2026-08-03（北京 05:10）ledger-hygiene 棘轮击穿：m7「自主循环零产出」欠账 0→1。DB 取证确认本次根因与 07-30 那次（PR #4483，learnings 未推 capture_atoms）不同：
1. m7 capture 子探针用 `NOW() - 24h` 滑动窗，而调度器每日运行时刻存在秒级漂移（08-01 21:10:21 → 08-02 21:10:27 UTC），前一日 atom 差 6 秒落在窗外 → count=0 → 击穿。
2. 探针把 ledger-hygiene 自己击穿时推送的 issue atom 也计入"自主循环产出"（指标自指）：近三日窗口内唯一的日常 atom 就是守卫自产 atom，指标退化为"测自己昨天的输出是否落进窗口"。
3. 排除自产 atom 后，击穿窗口内有机产出（learnings / handoff / merged PR）确实为 0——该事实应被如实报告，而不是被自产 atom 掩盖或被秒级竞态放大。

## Golden Path（核心场景）

系统从 [每日 ledger-hygiene 定时运行] → 经过 [m7 探针以确定性窗口统计有机产出] → 到达 [报告与棘轮反映真实的自主循环产出状态]

具体：
1. [触发条件] ledger-hygiene 每日北京 05:10 窗口运行，计算 m7「自主循环零产出」
2. [系统处理] capture 子探针只统计**有机产出**：排除 ledger-hygiene 守卫自身推送的 issue atom（自指来源）；统计窗口改为**确定性自然日窗口**（北京时间昨日 00:00–24:00），运行时刻的秒级/分钟级漂移不改变统计结果
3. [可观测结果] m7 的 value 展示 organic / self 分解计数；有机产出为 0 时才 debt+1 击穿（击穿标题与报告不变，仍走既有 issue/capture push 通路）；有机产出 ≥1 时 debt=0，不误报

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 窗口边界 atom：北京时间昨日 23:59:59 计入，今日 00:00:00 不计入（确定性边界，无秒级竞态）
- 窗口内全部 atom 均为守卫自产 → 有机计数 0 → 正常击穿（不被自产 atom 假绿）
- capture_atoms 表为空/不存在 → 探针保持既有"未激活"降级行为不变
- strategist 子探针（design_docs strategy_session）逻辑本次不改动，行为保持现状

## 范围限定

**在范围内**：packages/brain/src/ledger-hygiene.js 的 m7 capture 子探针统计口径（排除自产 + 确定性自然日窗口）+ 报告分解展示 + 复现 08-03 场景的回归测试
**不在范围内**：strategist 子探针从未激活（design_docs 无 strategy_session 记录）的修复——独立问题另立 issue；m1-m6 其他指标；棘轮机制本身；有机产出为何为零的运营问题

## 假设

- [ASSUMPTION: 守卫自产 atom 可通过内容前缀 `issue: [ledger-hygiene]`（或等价的来源标识）稳定识别]
- [ASSUMPTION: "自然日"以北京时间（Asia/Shanghai）为准，与守卫 05:10 北京窗口口径一致]
- [ASSUMPTION: 08-04 的 1→1 同源击穿在本修复合并后由下一次日常运行自然回落，无需手工重置棘轮]

## 预期受影响文件

- `packages/brain/src/ledger-hygiene.js`: m7 capture 子探针统计口径与报告分解
- `packages/brain/src/__tests__/ledger-hygiene.test.js`: 新增复现 08-03 场景的 failing test（自产 atom + 窗口边界秒级漂移），修复后转绿，永留 CI

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；本任务 step/feature 两级均无 NFR 决策 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: m7 指标计算失败必须走既有 safeMetric 降级并写 Brain log（保持现状不回退）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(0) + journey_feature(0) + area(62) 三源合并去重；area 级 62 条中 50 条为 [capture-triage]/smoke 自动沉淀的 learning 性噪音，此处注入 12 条真铁律，全量见 /tmp/inv_area.json -->
- [单slot串行] 一个 slot/会话内严格串行执行任务，并行只许跨 slot（来源: area）
- [禁写死环境假设] 屏幕外坐标/阈值/假设 env 值禁止写死，从环境推导或真机校准（来源: area）
- [真环境验证] 依赖真机/生产 env 的接缝断言必须真验过才算 done，否则只能标 logic-done-pending（来源: area）
- [测试多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area；本 sprint 无租户数据可豁免但不得引入跨租户读写）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area；本 sprint 不新增端点）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area）
- [字段语义重叠] 新字段与既有字段语义重叠时必须本 sprint 内消解或建正式 decision 挂队列（来源: area）
- [payload真源] target_environment 由 Brain 从 DB tasks.payload 读取，注册时必须正确设置（来源: area）
- [judge格式] .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]（来源: area）
- [theater检查] contract 文本含 android 关键词会触发 theater 不匹配警告（来源: area；本 sprint 不涉及）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本任务 payload 无 journey_id（capture_atoms urgent 路由，非路径 C 点火）→ 优雅降级 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql + vitest）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 复现 08-03 场景的回归测试（窗口内仅有守卫自产 atom + 前一日 atom 因秒级漂移落窗外）先 Red 后 Green，且 commit 进 CI 永留
# 2. 在测试库种入"昨日北京自然日内 1 条有机 atom + 1 条守卫自产 atom"，运行 m7 计算：organic=1 / self=1，debt=0
# 3. 种入"昨日仅守卫自产 atom"：organic=0，debt=1（真零产出仍击穿，不被自产 atom 假绿）
# 4. 运行时刻偏移 ±60 秒重算，m7 结果不变（确定性窗口，无秒级竞态）
# 5. 既有 ledger-hygiene.test.js / scheduler-jobs.test.js 全绿，m1-m6 与 strategist 子探针行为无回退
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 纯后端定时守卫指标计算，无 UI/engine/远端 agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部指标逻辑，本地 evaluator 用 vitest + psql + curl localhost:5221 即可端到端验证
## journey_id: none
## step_id: none（PrepPRD 未锚定）
