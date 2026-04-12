# Harness Pipeline 清理 Learning

## 问题
Harness Pipeline 积累了大量技术债：v3.x/v4.x 双路径共存、evaluator 死代码、重复逻辑、回调丢失无调和。

### 根本原因
1. v3.x → v4.x 迁移时只加新代码没删旧代码，sprint_* 和 harness_* 两套流程并行 9 个文件
2. Evaluator 被架构决策砍掉后 skill+注册+测试全没清理
3. propose_branch 提取逻辑在同一函数内 copy-paste 了两遍
4. webhook 回调丢失后任务永远卡在 in_progress，无调和机制

### 下次预防
- [ ] 删除功能时用 grep 全局搜索所有引用（task_type 注册、skill map、route、测试、预算配置）
- [ ] 同一函数内出现相同逻辑 2 次以上 → 立即提取共享函数
- [ ] 迁移完成后设置清理截止日期，不允许旧代码无限期保留
