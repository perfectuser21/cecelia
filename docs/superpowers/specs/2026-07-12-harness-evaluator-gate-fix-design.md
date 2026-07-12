# Harness evaluator/judge 虚设根因修复 + merge 前机器死闸（issue c36326c8）

## 背景

任务 5dbcc309（Brain task）+ Notion issue c36326c8：`initiative_run_events` 遥测证实近 7 天
evaluator/judge/report 三节点零执行——所有 relay run 最深只到 generator。已有真实事故：
一份合同砍了范围的 PR，靠"CI 绿 + 人工手动合并"放行，绕过了 harness 自己的 evaluator+judge
双门验收。铁律 09fb5c69 已立（人工救场必须补 evaluator），本任务补机器闸。

## 根因（cecelia-harness-debug 7 层排查 + systematic-debugging Phase 1 已定位，证据见下）

**不是** `harness-controller` SKILL.md 缺 Step 4-6 定义——v1.9.0 完整定义了
evaluator→judge→merge→report。真凶在 `packages/brain/src/harness-relay-watchdog.js`：

- `resumeStalledRelayRuns()` 负责在 relay session/容器消失时判断该 run 的下场
- 消失时若发现对应 PR 状态是 `MERGED`（两条路径：L150-186 直接读 DB 里的 pr_url；
  L191-232 按分支名反查 GitHub），**立刻**把 `initiative_runs.phase` 标 `done`、
  `tasks.status` 标 `completed`，**完全不检查 `initiative_run_events` 里
  是否真的有 `node='evaluator' AND status='done'` 的事件**
- 实测三个近期 run（zenithjoy-workspace）：`initiative_run_events` 最深到
  `generator=running`，从未到过 evaluator；但 `initiative_runs.phase='done'`，
  `evaluate_verdict`/`judge_verdict` 均为 NULL、`cost_usd=0.00`（不是 Step 7 report
  写的——report 硬性要求同时写这三个字段）
- 追查 PR #1237（zenithjoy-workspace）实际合并方：`mergedBy=perfectuser21`（人工账号，
  非 CI bot）——证实是"人工看 CI 绿之后手动 `gh pr merge`"，不是自动化竞态
- 核对 zenithjoy-workspace 全部 CI workflow：没有通用 auto-merge job（cecelia 侧
  07-04 修的 `should-auto-merge.sh` 判据只存在于 cecelia repo，从未移植过去），
  排除"自动合并竞态"这个候选，锁定"人工手动合并 + watchdog 无脑收敛"组合

**结论**：relay-watchdog 把"PR 已合并"直接等价于"harness 验收流程走完了"，这个等价关系
不成立——PR 能在 evaluator/judge 从未执行的情况下被合并（人工绕过），而 watchdog 发现
合并后只会静默把 run 标记成干净的 `done`，不留任何"这是一次未经验收的合并"的痕迹。这正是
过去 7 天 evaluator/judge/report 零执行却没人发现的原因：不是"没跑"被看见了，是"没跑"被
watchdog 悄悄粉饰成了"跑完了"。

## 方案

### 范围内（本次 PR，cecelia repo，纯代码，可测试）

**1. relay-watchdog 机器闸**：`resumeStalledRelayRuns()` 的两条"PR MERGED → 标 done"
分支，在标 done 前先查 `initiative_run_events` 是否存在
`node='evaluator' AND status='done'`：

- **存在**（正常路径）→ 行为不变：标 done/completed，照常触发
  `promoteRegressionOnHarnessMerged`
- **不存在**（本次要堵的洞）→ PR 已经合并，无法撤销，但**不能**再当成干净完成处理：
  - `initiative_runs` 仍标 `phase='done'`（终态，无法回退）但写
    `failure_reason='merged_without_evaluator_gate'`，留下"这次是未经验收合并"的机器可读痕迹
  - `tasks.status` 仍标 `completed`（PR 客观已合并，任务确实结束了）
  - **不**触发 `promoteRegressionOnHarnessMerged`（未经验收的改动不应该被当成"验证过的回归基线"提升）
  - 开一条 P1 Issue（`sub_area='brain'`），标题含 initiative_id + PR 链接，body 说明
    "此 run 的 PR 在 evaluator 从未执行的情况下被合并，未经 harness 验收"
  - 发 Bark 告警（照 `feedback_bark_not_feishu_for_urgent_alerts` 规矩：需要人立即处理的
    走 Bark 不走飞书）

这不是"拦住 merge 动作本身"（人工在 GitHub 网页点 merge，cecelia 代码天然够不到），而是拦住
"未经验收的合并被系统当成正常完成而彻底沉默"——这正是过去 7 天问题被隐藏的机制，堵住它就能让
下一次同类情况立刻被看见（Issue + Bark），而不是要等到有人手工翻 7 天遥测才发现。

**2. ledger-hygiene 新增 m6 指标**（`packages/brain/src/ledger-hygiene.js`，任务描述里明确
要的"ledger-hygiene 指标：done run 数 vs evaluator 事件数比值脱钩"）：

- 近 7 天 `initiative_runs`（`orchestrator_version='v2'`）里 `phase='done'` 的行数 vs 其中
  `initiative_id` 在 `initiative_run_events` 有 `node='evaluator' AND status='done'`
  记录的行数，算比例
- 走既有 m1-m5 同款棘轮机制（debt=脱钩数，只许降不许升，击穿开 issue，连续 3 天升 P1+Bark）
- 复用 `computeMetrics`/`evaluateRatchet`/`raiseBreachAlerts` 现有管线，不新增基础设施

### 范围外（本次不做，需要另立 issue/决策）

**GitHub 分支保护 required check**（真正能拦住"人工点 merge 按钮"的唯一机制）：
在 zenithjoy-workspace（以及 cecelia）repo 的分支保护规则里，对 `feat(harness):` 标题的
PR 加一条 required status check，去查 Brain 侧 evaluator=done 事件，缺失则 CI 红、GitHub
UI 的 merge 按钮直接变灰。这是修改另一个 repo 的分支保护设置（团队级共享基础设施变更），
不在本 PR 范围内，另开 Notion Issue 跟踪，留给主理人拍板是否要做、何时做。

## 测试策略

- **Unit（vitest，mock pool/execFn）**：
  - `harness-relay-watchdog.test.js` 现有"MERGED→标 done"用例全部补上
    `evaluatorGate: true` 的 mock 数据（行为不变的回归锚点）
  - 新增：`evaluatorGate: false` 场景（含直接 pr_url 分支与 GitHub 反查分支两条）——
    断言 `failure_reason='merged_without_evaluator_gate'`、不调用
    `promoteRegressionOnHarnessMerged`、Issue INSERT 与 Bark 都被调用
  - `ledger-hygiene.test.js`（新建或扩展现有文件）：m6 指标计算 + 棘轮击穿场景
- 无 E2E/集成层——watchdog 与 ledger-hygiene 都是纯 tick job，行为完全由 DB 状态决定，
  单元测试（mock pool）已经是决定性验证，不需要真机/真库回归

## 不做的事

- 不重新设计 relay-watchdog 的整体重点火架构（该架构本身工作正常，缺口只在"MERGED
  判定"这一处收口逻辑）
- 不试图解释"为什么 controller session 死在 generator 之后"——那是另一个独立问题
  （session 生命周期/资源问题），跟"合并绕过验收被静默接受"是两回事，本任务只堵后者
