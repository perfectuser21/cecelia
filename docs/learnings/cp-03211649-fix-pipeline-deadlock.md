# Learning: Pipeline 死锁修复

## 背景
修复 devloop-check.sh 中两个 Pipeline 死锁风险：PR 合并失败导致工作流死亡、Codex 审查无响应导致永久 pending。

### 根本原因
1. `gh pr merge` 失败后 `return 1` 是致命退出，Stop Hook 不会重试
2. `_check_codex_review` 缺少超时机制，如果 Brain/Codex 无响应则永久等待
3. 多个预先存在的测试文件（devloop-check-gates/pr-timing/step03-review-register）在 code_review_gate 从 Stage 3 前移到 Stage 2 后未同步更新
4. generate-feedback-report 测试因 vitest singleFork 模式下 CWD 与脚本相对路径不匹配导致 flaky

### 下次预防
- [ ] 在更改 Pipeline 阶段架构时，同步检查所有依赖该阶段注释/字段名的测试文件
- [ ] 涉及 shell 脚本相对路径的测试，应使用环境变量传递绝对路径
- [ ] `return 1` 在 devloop-check 中意味着"死亡"，新代码应默认用 `return 2`（重试）除非确实不可恢复
