# Learning: bash-guard develop 残留 + CI L2 重复 job

**日期**: 2026-04-02
**分支**: cp-04021644-engine-develop-cleanup

## 背景

CTO 架构审查发现两个 P1 问题：bash-guard.sh 的 DEPLOY_ALLOW_BRANCH 还包含已废弃的 develop 分支；CI L2 中 brain-l2 job 内联了一个与独立 brain-new-files-check job 完全相同的检查。

### 根本原因

分支策略从 develop → main 迁移时，bash-guard.sh 的 DEPLOY_ALLOW_BRANCH 未同步更新。
CI L2 的 brain-new-files 检查先在 brain-l2 job 中实现为内联 step，后来独立为单独 job 但忘记删除内联版本。

### 下次预防

- [ ] 分支策略变更时，全仓搜索 `develop` 并清理所有引用
- [ ] CI 新增独立 job 时，同时检查是否有旧的内联版本需要删除
