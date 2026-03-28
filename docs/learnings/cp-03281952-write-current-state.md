# Learning: 写 write-current-state.sh + 接入 /dev Stage 4

## 根本原因

Pipeline 被标记为孤儿的原因：
1. `.dev-lock` 文件缺失，Stop Hook 无法识别会话 → exit 0 → 工作流失去约束
2. 代码已写完（Step 2 完成），但进程已死，未继续到 Step 3（push）

## 下次预防

- [ ] Step 0 进入 worktree 后必须立即验证 `.dev-lock` 已创建
- [ ] Pipeline Rescue 流程：检查 `.dev-mode` 状态 → 找到最后一个已完成步骤 → 从下一步继续
- [ ] `DoD test` 中的字符串匹配应使用实际脚本中出现的完整词，避免大小写不一致问题

## 关键决策

- `write-current-state.sh` 写入 `.agent-knowledge/CURRENT_STATE.md`，由 Stage 4 自动调用
- Brain 离线时静默退出（`exit 0`），不阻塞 /dev 完成流程
- 用 python3 内联处理 JSON，避免引入额外依赖
