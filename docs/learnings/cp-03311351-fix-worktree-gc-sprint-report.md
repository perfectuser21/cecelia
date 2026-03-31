# Learning: 修复 worktree GC 误删 + Sprint Report 误导输出

**branch**: cp-03311351-fix-worktree-gc-sprint-report
**date**: 2026-03-31
**task**: aa1a59bb-a335-4bd6-80fa-8369586857e8

---

## 问题描述

Sprint Report 自动评分 7/40，根因是三个 bug 共同作用：

1. **worktree-gc.sh 缺少 `.dev-mode` 守卫**：当 context 超限导致 `.dev-session-active` 文件提前被删除时，GC 扫描不到活跃锁，误判为"可以删除"，把正在运行的 worktree 清理掉。

2. **stop-dev.sh `.dev-session-active` 删除时机**（已验证正确）：所有4个删除点均已在 `cleanup_done: true` 守卫内，不需要修改。

3. **generate-sprint-report.sh 误导性输出**：Planner seal 文件不存在时，`PLANNER_ALL_TODO="unknown"`，但 else 分支却输出硬编码的 `❌ 否（Planner 预填了 Test）`，并给出 5 分。这既误导了对"Planner 是否隔离"的判断，也人为抬高了评分。

---

### 根本原因

**`.dev-session-active` 是软锁**：设计上在 dev 流程启动时创建，结束时删除。但 context 超限时，Claude 会话被强制终止，cleanup 逻辑可能未执行，导致文件"过早消失"或"从未创建"。

**`.dev-mode.{branch}` 是硬锁**：Stage 1（Spec）创建，Stage 4（Ship）完成后才删除（写入 `cleanup_done: true`）。context 超限不影响它——文件本身持久存在于磁盘。

**Sprint Report 的 `unknown` 分支没有单独处理**：原始代码把 `unknown`（seal 缺失）和 `false`（seal 存在但 Planner 预填了 Test）合并在同一个 `else` 里，导致两种完全不同的情况输出相同的误导文字。

---

### 下次预防

- [ ] GC 脚本需要同时检查软锁（`.dev-session-active`）和硬锁（`.dev-mode.{branch}`）。单一锁有单点失效风险。
- [ ] 任何三态（`true/false/unknown`）的变量都必须有三个独立分支处理，不能把 `false` 和 `unknown` 合并在 `else` 中。
- [ ] Sprint Report 评分公式：状态未知 = 0 分，不应给中间分。给中间分会掩盖真实问题，让报告失去诊断价值。
- [ ] 每次看到 `else` 分支处理多个不同语义的状态时，立即重构为 `elif`。
