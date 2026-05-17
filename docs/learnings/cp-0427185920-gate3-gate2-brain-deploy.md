# Learning: Gate 3 + Gate 2 Brain HTTP 自动部署

## 根本原因

旧 brain-deploy.yml（PR #2675）失败原因：
1. 使用 SSH（需要 BRAIN_DEPLOY_SSH_KEY secret，未配置）
2. 盲目 revert HEAD（Gate 2 会 revert 触发部署的代码，而非破坏部署配置的代码）
3. GITHUB_TOKEN 权限不足创建 PR

## 下次预防

- [ ] 所有 Brain 部署必须使用 DEPLOY_TOKEN + HTTP API（与 deploy.yml 模式一致）
- [ ] Gate 2 只创建告警任务，不自动 revert（防止误删正确代码）
- [ ] 新 workflow 的 concurrency group 必须与 deploy.yml (`deploy-production`) 隔离
- [ ] 409 = 部署正在进行（非失败），需显式处理
