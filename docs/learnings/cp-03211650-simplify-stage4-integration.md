## /simplify 集成 Stage 4 + cleanup 过程文件清理（2026-03-21）

### 根本原因

Stage 4 Ship 流程缺少代码简化审查步骤，开发完成后直接写 Learning，没有机会审查和简化新增代码。同时 cleanup.sh 遗漏了 `.dev-execution-log.*.jsonl`、`.dev-sentinel.*`、`.dev-orphan-retry-*` 三类过程文件的清理，导致 worktree 中残留垃圾文件。

### 下次预防

- [ ] 新增过程文件类型时，同步更新 cleanup.sh 的清理列表
- [ ] Stage 4 的步骤顺序调整后，确认 devloop-check.sh 状态机不受影响
