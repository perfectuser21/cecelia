# Learning：executor.js claim 锁泄漏 + report slash command 静默降级

分支: cp-0603091820-executor-claim-report-fix
Brain task: ff3a8ec2-4f1e-40f4-a746-db97d22742e7

## 背景

executor.js 同时存在两个独立但同源（"复制粘贴时漏掉一段/没对齐其他分支"）的机械 bug：

- **Bug A**：`syncOrphanTasksOnStartup()` 的 `harness_initiative` requeue 分支，把任务从 `in_progress` 改回 `queued` 时只设了 `status/payload/updated_at`，**没清 `claimed_by/claimed_at/started_at`**。而 `dispatch-helpers.js` 选任务带 `AND t.claimed_by IS NULL`，死 runner 残留的 claim 锁让该任务永远选不出来 → Brain 重启后死锁在 queued。`tick-runner.js` 的正常 requeue（:1270/:1297）早就会清这三件套，唯独这条 LangGraph 分支漏了。
- **Bug B**：`_prepareHarnessReportPrompt` 的 prompt 第一行是裸的 `/harness-report`。容器内 headless `claude -p` **不展开 slash command**，report agent 收到字面量 + 零 SKILL 指令 → 空壳报告但 exit 0 → 静默降级。其余 5 个阶段（planner/proposer/reviewer/generator/evaluator）早已改成 inline `loadSkillContent(...)`，只剩 report 漏网（Bug 7 复刻）。

## 根本原因

1. **同类逻辑多副本不对齐**：requeue 清字段、SKILL 内联这两件事在代码库里都有"正确样板"（tick-runner 的 requeue、buildGeneratorPrompt 的 inline），但 executor.js 里的对应分支是早期独立写的，后续样板演进时没有回头同步这两处 → 单点漏改。
2. **静默降级缺断言**：headless 容器对未展开的 slash command 不报错（exit 0），claim 残留也不报错（只是选不出任务），两者都"安静地错"，没有任何 fail-fast 把问题暴露在 CI 或运行时。

## 下次预防

- [ ] 任何"把任务从占用态改回可调度态"的 UPDATE，必须清 `claimed_by/claimed_at/started_at` 三件套——以 tick-runner.js requeue 为唯一样板，新增分支照抄。
- [ ] 任何"派给 headless 容器跑的 prompt"禁止用裸 `/skill-name`，一律 `loadSkillContent(name)` inline；新增阶段时对照 harness-utils.js 的 buildXPrompt 模式。
- [ ] 新增 prompt 构造函数加单测断言：输出**不以 `/` 开头**（杜绝 slash command 回潮）。
- [ ] `loadSkillContent` 引用的 skill 必须能在 CI fallback 路径 `packages/workflows/skills/` 解析到，否则会触发 B56 fail-fast——本次 `sprint-report` 因未同步进该目录，故未一并 inline 化。
