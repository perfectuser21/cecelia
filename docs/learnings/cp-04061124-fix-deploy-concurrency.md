# Learning: 修复 deploy 并发冲突

## 上下文

多个 PR 同时合并时，多个 deploy workflow 并发执行，互相覆盖 deployState，导致状态不可预测。

### 根本原因

1. **ops.js 无并发锁**：`POST /api/brain/deploy` 直接写 `deployState.status = 'running'`，无任何 busy 检测，并发请求会竞争写入状态
2. **deploy.yml 无 concurrency group**：GitHub Actions 默认允许多个 push 触发多个并发 workflow，无串行保障

### 修复方案

- **ops.js**：在 token 校验后、状态写入前，检查 `deployState.status === 'running' || 'rolling_back'`，满足则返回 409
- **deploy.yml**：在 `on:` 块后加 `concurrency: group: deploy-production, cancel-in-progress: false`，保证串行排队

### 下次预防

- [ ] 所有状态机端点（running/rolling_back 等）在写入新状态前必须先检查当前状态
- [ ] 有副作用的 GitHub Actions workflow（deploy/rollback）默认加 concurrency group
- [ ] 新增 deploy 相关端点时，参考 deploy-status.test.js 的 409 测试模板
