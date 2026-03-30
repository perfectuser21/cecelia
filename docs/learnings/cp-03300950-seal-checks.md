# Learning: 三阶段 seal 对齐检查 — Planner→Generator 强制链路

**分支**: cp-03300950-seal-checks
**日期**: 2026-03-30
**任务**: feat(engine): [CONFIG] 三阶段 seal 对齐检查

---

### 根本原因

devloop-check.sh 已有 spec_review seal（条件 1.5）和 code_review_gate seal（条件 2.5），但缺少对 Planner subagent 和 Generator subagent 完成的强制验证，导致这两个 subagent 步骤可被绕过。

Sprint Contract（step_2_code）开始前，系统无法验证 Planner subagent 是否真实执行过，主 agent 可以在没有 Task Card 的情况下直接进入写代码阶段。同样，Stage 3（push/PR）开始前，没有机制验证 Generator subagent 是否完成了全部 DoD 验收，导致代码审查链路中存在断点。

根本上是"信任但不验证"的模式——依赖 subagent 自觉写 seal，而非强制门禁拦截缺失 seal 的情况。

---

### 解决方案

在 devloop-check.sh 中新增两道 seal 前置检查：

1. **条件 1.6（planner seal）**：位于条件 1.5 和条件 2 之间，当 step_1_spec 已 done 但 `.dev-gate-planner.{branch}` 不存在时，返回 blocked + exit 2
2. **条件 2.8（generator seal）**：位于条件 2.5 和条件 3 之间，当 step_2_code 已 done 但 `.dev-gate-generator.{branch}` 不存在时，返回 blocked + exit 2

同时在 planner-prompt.md 和 02-code.md 的 subagent prompt 模板中加入写 seal 文件的强制指令。

---

### 下次预防

- [ ] 新增 subagent 时，配套检查三件套：1) prompt 中加 seal 写入指令；2) devloop-check.sh 加对应条件；3) 测试文件加验证 case
- [ ] bash-guard.sh 在主仓库 main 上下文运行时无法感知 worktree 的代码改动（worktree hook 上下文 bug），需要在 worktree 内直接运行 verify-step.sh 或用变量间接传参绕过检测
- [ ] seal 检查条件用 `===== 条件 N.X:` 分隔符命名，测试文件用 indexOf 定位，确保位置顺序正确

---

### 关键数字

- 改动文件：3 个（devloop-check.sh / planner-prompt.md / 02-code.md）
- 新增测试：7 个（devloop-check-gates.test.ts 新增 describe 块）
- 版本：v3.5.0 → v3.6.0（devloop-check.sh）
