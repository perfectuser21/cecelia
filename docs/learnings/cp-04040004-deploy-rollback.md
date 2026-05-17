# Learning: cp-04040004-deploy-rollback

日期: 2026-04-04

## 任务摘要

为 Brain 部署流程新增自动回滚机制：deploy.yml 失败时通过 CI 触发 `POST /api/brain/deploy/rollback`，Brain 在本地执行 git checkout → npm install → pm2 restart。

## 根本原因

原有 deploy.yml 在部署失败时只 `exit 1`，没有回滚动作，导致 Brain 可能停留在损坏状态，需要人工介入。

## 设计决策

1. **回滚端点与 deploy 端点并列**：复用 `deployState` 对象，状态从 `rolling_back` 变为 `rolled_back` 或 `rollback_failed`，`GET /deploy/status` 可观测全过程。

2. **降级策略优先**：当 `DEPLOY_TOKEN` 为空、`STABLE_SHA` 为全零或空时，回滚 step 输出 `::warning::` 后 `exit 0`（不让 CI 因回滚失败叠加报错）。

3. **SHA 安全校验**：正则 `/^[0-9a-f]{7,40}$/` 防止路径穿越攻击（`../../etc/passwd` 等）。

4. **异步执行模式**：与 `/deploy` 相同，先 202 响应再后台执行，避免 CI curl 超时。

## 下次预防

- [ ] 新增 webhook 端点时，确认复用 deployState 或新建独立状态对象
- [ ] CI job 中涉及敏感 SHA/token 的 curl 调用，必须添加 `|| echo "000"` 兜底防止 exit 2
- [ ] 测试文件中 `vi.stubEnv` 要在 `vi.resetModules()` 之前调用，确保 env 注入生效
