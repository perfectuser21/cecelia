### 根本原因

本次实现修复了 3 个 Feature：
1. stop-dev.sh 缺少 `step_2_code` 和 `pr_url` 关键词（合同要求这两个词作为 Harness 完成条件的文档说明）
2. devloop_check 函数已有正确的 Harness 逻辑（harness_mode + cleanup_done 边界、step_2_code + PR 检查），验证全通过
3. E2E 测试从 22 增加到 28 个，补充了 Harness 模式完整路径、cleanup_done 残留误标、无 PR 边界等场景

### 下次预防

- [ ] stop-dev.sh 的注释需与其委托的 devloop_check 逻辑保持同步，关键词（step_2_code/pr_url）应体现在注释中
- [ ] E2E 测试新增场景需同时含 harness_mode=true 和 harness_mode=false 对比，避免只测一条路径
- [ ] vitest 在 worktree 中运行需指定 --root 参数，否则从主仓库 node_modules 找不到测试文件更新
