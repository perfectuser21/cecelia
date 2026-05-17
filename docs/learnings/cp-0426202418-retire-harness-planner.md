# Learning: 退役 harness_planner pipeline

## 上下文
PR #2640 投产 harness_initiative full graph (Phase A+B+C) 后，老的 harness_planner 6 节点 GAN pipeline 功能被覆盖。但没人接手清退役，留下 4 个 deprecation stub 文件 + executor 路由 + routes 层 SQL + task-router 字典。Audit 显示 14 天 0 真实 caller（仅 zombie task + 测试），可安全退役。

本 PR 一并清理：
- 抽 3 共享函数到 harness-shared.js（parseDockerOutput / extractField / loadSkillContent）
- 删 6 个生产文件：harness-graph.js (43KB) + harness-graph-runner.js + 4 stub
- executor.js 收紧路由：harness_planner 加入 _RETIRED_HARNESS_TYPES → terminal_failure
- routes/goals + status + harness 删/改 SQL 查询（原 harness_planner 改用 harness_initiative）
- task-router VALID_TASK_TYPES + LOCATION_MAP + capability map 移除 harness_planner
- 删 8 个过时测试 + 改 3 个测试

## 根本原因
- PR #2640 引入 full graph 时为安全过渡保留了老 pipeline 入口和 stub 文件，注释里写 "下个清理 PR 删"，但没注册 cleanup task → 被遗忘
- 同样的"留 stub 等下个 PR"在 PR #2652（flip default flag）也出现了 — Code Reviewer 当时建议注册 cleanup task，本 PR 一并执行
- 第一轮 brainstorm 的 reviewer 在抽函数清单里漏掉 loadSkillContent —— harness-initiative.graph.js 用到这个函数，会因 harness-graph.js 被删 import 失败启动炸；幸好审查时被抓到补回

## 下次预防
- [ ] 任何"保留 N 天兜底/stub"代码必须在合并 PR 时**同时注册一个 cleanup task 到 Brain**（带具体过期日期）
- [ ] 退役一个 task_type 之前必须先 audit 真实 caller（grep 代码 + DB query 14-30 天派发记录），区分 zombie 和真用户
- [ ] 抽函数到新文件时务必 grep **整个 monorepo** 确认所有 caller，不能只看一个文件 — 第一轮 reviewer 就因这点 REJECT（loadSkillContent 漏了）
- [ ] 涉及大规模文件删除的 PR 必须额外 grep 其他间接依赖（不只是直接 import）：删 harness-graph.js 时还要把 harness-parse-tasks.test.js / harness-graph-v2-flow.test.js / harness-graph-nodes-coverage.test.js / harness-initiative-runner-* 等所有引用一并处理
- [ ] 工作时频繁 commit（即使是 wip:）— 本次执行过程中 worktree 被自动 cleanup 进程意外清空 2 次，全靠中途 wip commit 防止丢工作
