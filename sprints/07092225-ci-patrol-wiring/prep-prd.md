# 小改动 PrepPRD：ci-patrol Brain 接线（每日调度 + 派发执行）

## 改什么
cecelia repo，照两个现成模式接线，让 task_type=ci_patrol 每天自动建任务并被 executor 派给 ci-patrol skill：

1. **新建 `packages/brain/src/ci-patrol-scheduler.js`**（照抄 `daily-review-scheduler.js` 模式）：
   - `isInCiPatrolWindow(now)`：UTC 00:00-00:05 窗口（= 北京 08:00，等 03:00 刀A + 04:30 刀B nightly 跑完）
   - `hasTodayCiPatrol(pool)`：同日去重（task_type='ci_patrol' 当天已有则跳过）
   - `createCiPatrolTask(pool)`：INSERT tasks（task_type='ci_patrol', priority='P2', created_by='cecelia-brain', trigger_source='brain_auto', payload={date}）
   - `triggerCiPatrol(pool)`：窗口判断 + 去重 + 创建，tick 末尾调用
2. **tick 接线**：在调用 `triggerDailyReview` 的同一位置（tick-runner/tick-scheduler，以现有 daily-review 接线处为准）追加 `triggerCiPatrol(pool)`
3. **executor 注册**：`getSkillForTaskType` 的 skillMap 加 `ci_patrol: 'ci-patrol'`；新增 `_prepareCiPatrolPrompt`（照 `_prepareStrategistDecisionPrompt` 模式：`loadSkillContent('ci-patrol')` 内联 + 注入 task_id/date）

ci-patrol skill 本体已存在（~/.claude-account1/skills/ci-patrol/SKILL.md，loadSkillContent 第一搜索路径可命中）。

## 为什么改
用户 0709 拍板（决策 db1b393b，方案A）：要一个每天跑的 CI/CD 巡检员按 line 报硬伤 + 棘轮 guard。skill 已建，缺的就是 Brain 的定时派发通路。

## 关联上下文
- 决策：db1b393b（立项，方案A）
- Brain task：fd0881dd-a083-42b7-b813-6a9d93c84e02
- 模式来源：daily-review-scheduler.js（code_review 每日 02:00 UTC）+ executor.js strategist_decision 接线（0708 decision）

## 影响范围
纯新增 scheduler 模块 + tick 末尾一行调用 + executor skillMap 一项 + 一个 prompt 准备函数。不动现有 code_review/arch_review 调度。executor 找不到 SKILL.md 会 fail-fast（loadSkillContent B56 行为），不会静默假成功。

## 验收标准
- [ ] commit-1 = failing test 先行（scheduler 窗口/去重/创建 三函数 + skillMap 含 ci_patrol 断言）
- [ ] commit-2 = 实现让测试绿
- [ ] proven to work：本地手动 INSERT 一条 ci_patrol 任务（或直接调 triggerCiPatrol 注入窗口内时间），确认 executor 能拼出含 SKILL.md 全文的 prompt（单测或本地脚本验证）
- [ ] CI 全绿
