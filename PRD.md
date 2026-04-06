# PRD: Harness Pipeline 防误杀

## 背景
昨晚 sprint_fix 任务被 escalation emergency_brake 批量取消，原因是 alertness healthScore 与 diagnosis.summary 两套标准打架，导致系统"因为健康"触发紧急刹车，顺带清空 Harness 队列。

## 修复目标
6 个问题全修，确保 Harness pipeline 不被系统自保机制误杀。

## 成功标准
- [ ] cancelPendingTasks 白名单包含全部 Harness 类型
- [ ] pauseLowPriorityTasks 白名单包含全部 Harness 类型
- [ ] alertness index.js：健康时不触发 ALERT 升级
- [ ] task-cleanup PROTECTED_TASK_TYPES 包含全部 Harness 类型
- [ ] watchdog 对 Harness 任务有更长宽限期
- [ ] sprint-evaluator SKILL.md 有 git commit+push evaluation.md 步骤
